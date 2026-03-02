const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const config = require('../config');
const logger = require('../logger');
const ReplyGenerator = require('../replyGenerator');

// ============================================================
//  LINKEDIN SCANNER — MODE COOKIES + PROXY RÉSIDENTIEL
//  LinkedIn bloque les IP de datacenters (Railway, AWS, etc.)
//  Un proxy résidentiel est OBLIGATOIRE pour tourner en cloud.
// ============================================================

class LinkedInScanner {
  constructor(store) {
    this.store = store;
    this.replyGen = new ReplyGenerator();

    this.cookie = process.env.LINKEDIN_LI_AT;
    this.csrfToken = process.env.LINKEDIN_CSRF_TOKEN || '';
    this.enabled = !!this.cookie;
    this._myUrn = null;

    // Proxy config
    // Format: http://user:pass@host:port
    this.proxyUrl = process.env.PROXY_URL || '';
    this.proxyAgent = this.proxyUrl ? new HttpsProxyAgent(this.proxyUrl) : null;

    if (this.enabled && !this.proxyAgent) {
      logger.warn('LinkedIn: no PROXY_URL set — LinkedIn BLOCKS datacenter IPs (Railway, AWS, etc.)');
      logger.warn('LinkedIn: get a residential proxy from brightdata.com, oxylabs.io, or smartproxy.com (~$5-10/mo)');
      logger.warn('LinkedIn: set PROXY_URL=http://user:pass@host:port in Railway variables');
      logger.warn('LinkedIn: OR run the bot from your home PC instead of Railway');
    }

    if (this.enabled) {
      logger.info(`LinkedIn scanner initialized (cookie mode${this.proxyAgent ? ' + proxy' : ' — NO PROXY ⚠️'})`);
    } else {
      logger.warn('LinkedIn scanner disabled — missing LINKEDIN_LI_AT');
    }
  }

  // Axios config with optional proxy
  _axiosConfig(extraConfig = {}) {
    const cfg = {
      headers: this._getHeaders(),
      timeout: 20000,
      maxRedirects: 5,
      ...extraConfig,
    };

    if (this.proxyAgent) {
      cfg.httpsAgent = this.proxyAgent;
      cfg.proxy = false; // Use agent, not axios built-in proxy
    }

    return cfg;
  }

  _getHeaders() {
    return {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      Accept: 'application/vnd.linkedin.normalized+json+2.1',
      'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      Referer: 'https://www.linkedin.com/feed/',
      Origin: 'https://www.linkedin.com',
      'x-li-lang': 'fr_FR',
      'x-li-page-instance': 'urn:li:page:feed_index;' + this._randomHex(8),
      'x-li-track': JSON.stringify({
        clientVersion: '1.13.8834',
        mpVersion: '1.13.8834',
        osName: 'web',
        timezoneOffset: 1,
        deviceFormFactor: 'DESKTOP',
        mpName: 'voyager-web',
        displayDensity: 1,
      }),
      'x-restli-protocol-version': '2.0.0',
      'csrf-token': this.csrfToken,
      Cookie: `li_at=${this.cookie}; JSESSIONID="${this.csrfToken}"; lang=v=2&lang=fr-fr`,
    };
  }

  // ============================================================
  //  SESSION CHECK
  // ============================================================

  async checkSession() {
    if (!this.enabled) return false;

    try {
      if (!this.csrfToken) {
        await this._fetchCsrfToken();
      }

      const res = await axios.get(
        'https://www.linkedin.com/voyager/api/me',
        this._axiosConfig()
      );

      const profile = res.data?.miniProfile || res.data || {};
      const name =
        profile.firstName ||
        res.data?.firstName?.localized?.fr_FR ||
        res.data?.firstName?.localized?.en_US ||
        'Unknown';

      this._myUrn = profile.entityUrn || res.data?.entityUrn || '';
      logger.info(`LinkedIn: session valid — logged in as ${name}`);
      return true;
    } catch (err) {
      const status = err.response?.status;
      const msg = err.message || '';

      if (msg.includes('redirect') || msg.includes('Redirect')) {
        logger.error('LinkedIn: redirect loop — your IP is BLOCKED by LinkedIn');
        logger.error('LinkedIn: you need a residential proxy (PROXY_URL) or run from home PC');
        return false;
      }

      logger.error(`LinkedIn session check failed: ${status || msg}`);
      if (status === 401 || status === 403) {
        this.enabled = false;
      }
      return false;
    }
  }

  async _fetchCsrfToken() {
    try {
      const res = await axios.get('https://www.linkedin.com/', {
        ...this._axiosConfig({
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            Cookie: `li_at=${this.cookie}`,
          },
        }),
      });

      const setCookies = res.headers['set-cookie'] || [];
      for (const c of setCookies) {
        const match = c.match(/JSESSIONID="?([^";]+)"?/);
        if (match) {
          this.csrfToken = match[1].replace(/"/g, '');
          logger.info(`LinkedIn: CSRF token fetched OK`);
          return;
        }
      }

      logger.warn('LinkedIn: could not auto-fetch CSRF token');
    } catch (err) {
      if (err.message?.includes('redirect')) {
        logger.error('LinkedIn: CSRF fetch blocked (IP blocked) — need residential proxy');
      } else {
        logger.error(`LinkedIn CSRF fetch error: ${err.message}`);
      }
    }
  }

  // ============================================================
  //  SCAN
  // ============================================================

  async scan() {
    if (!this.enabled) return [];

    const results = [];
    const searchQueries = [
      'facture freelance',
      'facturation auto-entrepreneur',
      'logiciel facturation indépendant',
      'outil devis freelance',
      'galère facturation freelance',
      'devenir freelance france',
      'micro-entreprise comptabilité',
      'outil facturation gratuit',
    ];

    for (const query of searchQueries) {
      try {
        const posts = await this._searchPosts(query);
        results.push(...posts);
        await this._sleep(3000 + Math.random() * 5000);
      } catch (err) {
        const msg = err.message || '';

        if (msg.includes('redirect')) {
          logger.error(`LinkedIn search blocked (${query}): IP blocked by LinkedIn`);
          continue;
        }

        logger.error(`LinkedIn search error (${query}): ${msg}`);

        if (err.response?.status === 401 || err.response?.status === 403) {
          this.enabled = false;
          return results;
        }

        if (err.response?.status === 429) {
          logger.warn('LinkedIn: rate limited — pausing 10 minutes');
          await this._sleep(600000);
        }
      }
    }

    const unique = [...new Map(results.map((r) => [r.id, r])).values()];
    logger.info(`LinkedIn: found ${unique.length} relevant posts`);
    return unique;
  }

  async _searchPosts(query) {
    const posts = [];

    const res = await axios.get(
      'https://www.linkedin.com/voyager/api/search/dash/clusters',
      this._axiosConfig({
        params: {
          decorationId:
            'com.linkedin.voyager.dash.deco.search.SearchClusterCollection-175',
          origin: 'GLOBAL_SEARCH_HEADER',
          q: 'all',
          query: `(keywords:${encodeURIComponent(query)},datePosted:(r86400),resultType:(CONTENT))`,
          start: 0,
          count: 20,
        },
      })
    );

    const elements = this._extractPosts(res.data);

    for (const post of elements) {
      if (this._isRelevant(post.text) && !this.store.hasReplied('linkedin', post.id)) {
        posts.push({
          id: post.id,
          platform: 'linkedin',
          title: post.text.substring(0, 100),
          content: post.text,
          text: post.text,
          author: post.authorName,
          authorUrn: post.authorUrn,
          postUrn: post.postUrn,
          category: config.categorizePost(post.text),
          score: this._scorePost(post.text),
          url: `https://www.linkedin.com/feed/update/${post.postUrn}/`,
          created: new Date(post.timestamp || Date.now()),
        });
      }
    }

    return posts;
  }

  _extractPosts(data) {
    const posts = [];
    try {
      const included = data?.included || [];
      for (const item of included) {
        if (item.commentary || item.$type?.includes('UpdateV2')) {
          const text = item.commentary?.text?.text || item.commentary?.text || '';
          const postUrn = item.updateMetadata?.urn || item.urn || '';
          const authorName = item.actor?.name?.text || item.actor?.name || 'Unknown';
          const authorUrn = item.actor?.urn || '';

          if (text && text.length > 20) {
            posts.push({
              id: `li_${Buffer.from(postUrn || text.substring(0, 50)).toString('base64').substring(0, 20)}`,
              text, postUrn, authorName, authorUrn,
            });
          }
        }
      }
    } catch (err) {
      logger.error(`LinkedIn parse error: ${err.message}`);
    }
    return posts;
  }

  // ============================================================
  //  REPLY
  // ============================================================

  async reply(post) {
    if (!this.enabled) return false;
    const isDryRun = process.env.DRY_RUN === 'true';

    try {
      const category = config.categorizePost(post.content || post.text);
      const replyText = await this.replyGen.generateReply(post.content || post.text, 'linkedin', category);

      const activityUrn = this._extractActivityUrn(post.postUrn);
      if (!activityUrn) {
        this.store.markReplied('linkedin', post.id);
        return false;
      }

      if (isDryRun) {
        logger.info(`[DRY RUN] Would reply to ${post.id}: "${replyText.substring(0, 80)}..."`);
        this.store.markReplied('linkedin', post.id);
        return true;
      }

      await axios.post(
        'https://www.linkedin.com/voyager/api/feed/comments',
        { threadId: activityUrn, attributed: { text: replyText } },
        this._axiosConfig({ headers: { ...this._getHeaders(), 'Content-Type': 'application/json', 'x-restli-method': 'create' } })
      );

      this.store.markReplied('linkedin', post.id);
      logger.info(`✅ LinkedIn reply | ${post.author} | cat=${category}`);
      logger.info(`   "${replyText.substring(0, 120)}..."`);
      await this._sleep(60000 + Math.random() * 120000);
      return true;
    } catch (err) {
      logger.error(`LinkedIn reply error (${post.id}): ${err.response?.status || err.message}`);
      if (err.response?.status === 401 || err.response?.status === 403) this.enabled = false;
      if (err.response?.status === 429) await this._sleep(900000);
      if (err.response?.status === 404) this.store.markReplied('linkedin', post.id);
      return false;
    }
  }

  // ============================================================
  //  HELPERS
  // ============================================================

  _extractActivityUrn(postUrn) {
    if (!postUrn) return null;
    if (postUrn.includes('activity:') || postUrn.includes('ugcPost:')) return postUrn;
    const match = postUrn.match(/(\d{10,})/);
    return match ? `urn:li:activity:${match[1]}` : null;
  }

  _isRelevant(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    const all = [...config.keywords.primary, ...config.keywords.secondary, ...config.keywords.pain_points];
    return all.some((kw) => lower.includes(kw.toLowerCase()));
  }

  _scorePost(text) {
    if (!text) return 0;
    const lower = text.toLowerCase();
    let score = 0;
    for (const kw of config.keywords.primary) if (lower.includes(kw.toLowerCase())) score += 3;
    for (const kw of config.keywords.pain_points) if (lower.includes(kw.toLowerCase())) score += 2;
    for (const kw of config.keywords.secondary) if (lower.includes(kw.toLowerCase())) score += 1;
    return score;
  }

  _randomHex(len) {
    return [...Array(len)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
  }

  _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

module.exports = LinkedInScanner;
