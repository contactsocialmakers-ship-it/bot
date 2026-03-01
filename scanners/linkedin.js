const axios = require('axios');
const config = require('../config');
const logger = require('../logger');
const ReplyGenerator = require('../replyGenerator');

// ============================================================
//  LINKEDIN SCANNER — MODE COOKIES (li_at)
//  Léger, rapide, pas besoin de Chrome/Puppeteer
//  Même méthode que Waalaxy, Phantombuster, etc.
// ============================================================

class LinkedInScanner {
  constructor(store) {
    this.store = store;
    this.replyGen = new ReplyGenerator();

    this.cookie = process.env.LINKEDIN_LI_AT;
    this.csrfToken = process.env.LINKEDIN_CSRF_TOKEN || '';
    this.enabled = !!this.cookie;
    this._myUrn = null;

    // Headers qui imitent un vrai navigateur
    this.headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/vnd.linkedin.normalized+json+2.1',
      'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
      'x-li-lang': 'fr_FR',
      'x-li-track':
        '{"clientVersion":"1.13.8834","mpVersion":"1.13.8834","osName":"web","timezoneOffset":1,"deviceFormFactor":"DESKTOP","mpName":"voyager-web","displayDensity":1}',
      'x-restli-protocol-version': '2.0.0',
      Cookie: `li_at=${this.cookie}; JSESSIONID="${this.csrfToken}"`,
      'csrf-token': this.csrfToken,
    };

    if (this.enabled) {
      logger.info('LinkedIn scanner initialized (cookie mode)');
    } else {
      logger.warn('LinkedIn scanner disabled — missing LINKEDIN_LI_AT');
    }
  }

  // ============================================================
  //  SCAN — Recherche de posts pertinents
  // ============================================================

  async scan() {
    if (!this.enabled) return [];

    const valid = await this._checkSession();
    if (!valid) {
      logger.error('LinkedIn: session expired — update LINKEDIN_LI_AT cookie');
      return [];
    }

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
        logger.error(`LinkedIn search error (${query}): ${err.message}`);

        if (err.response?.status === 401 || err.response?.status === 403) {
          logger.error('LinkedIn: authentication failed — cookie expired');
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

    try {
      const res = await axios.get(
        'https://www.linkedin.com/voyager/api/search/dash/clusters',
        {
          headers: this.headers,
          params: {
            decorationId:
              'com.linkedin.voyager.dash.deco.search.SearchClusterCollection-175',
            origin: 'GLOBAL_SEARCH_HEADER',
            q: 'all',
            query: `(keywords:${encodeURIComponent(query)},datePosted:(r86400),resultType:(CONTENT))`,
            start: 0,
            count: 20,
          },
          timeout: 15000,
        }
      );

      const elements = this._extractPosts(res.data);

      for (const post of elements) {
        if (this._isRelevant(post.text) && !this.store.hasReplied('linkedin', post.id)) {
          posts.push({
            id: post.id,
            platform: 'linkedin',
            title: post.text.substring(0, 100),
            content: post.text,
            author: post.authorName,
            authorUrn: post.authorUrn,
            postUrn: post.postUrn,
            url: `https://www.linkedin.com/feed/update/${post.postUrn}/`,
            created: new Date(post.timestamp || Date.now()),
          });
        }
      }
    } catch (err) {
      throw err;
    }

    return posts;
  }

  _extractPosts(data) {
    const posts = [];

    try {
      const included = data?.included || [];

      for (const item of included) {
        if (
          item.$type === 'com.linkedin.voyager.feed.render.UpdateV2' ||
          item.commentary ||
          item.resharedUpdate
        ) {
          const text =
            item.commentary?.text?.text || item.commentary?.text || '';
          const postUrn =
            item.updateMetadata?.urn || item.urn || item['*updateMetadata'] || '';
          const authorName =
            item.actor?.name?.text || item.actor?.name || 'Unknown';
          const authorUrn = item.actor?.urn || '';

          if (text && text.length > 20) {
            posts.push({
              id: `li_${Buffer.from(postUrn || text.substring(0, 50))
                .toString('base64')
                .substring(0, 20)}`,
              text,
              postUrn,
              authorName,
              authorUrn,
              timestamp: item.actor?.subDescription?.text || null,
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
  //  REPLY — Poster un commentaire via Voyager API
  // ============================================================

  async reply(post) {
    if (!this.enabled) return false;

    try {
      const category = config.categorizePost(post.content);
      const replyText = await this.replyGen.generateReply(
        post.content,
        'linkedin',
        category
      );

      const activityUrn = this._extractActivityUrn(post.postUrn);
      if (!activityUrn) {
        logger.warn(`LinkedIn: cannot extract activity URN for ${post.id}`);
        this.store.markReplied('linkedin', post.id);
        return false;
      }

      // Normaliser l'URN pour l'API comments
      // Format attendu : urn:li:activity:XXXX ou urn:li:ugcPost:XXXX
      const encodedUrn = encodeURIComponent(activityUrn);

      await axios.post(
        `https://www.linkedin.com/voyager/api/feed/comments`,
        {
          threadId: activityUrn,
          attributed: {
            text: replyText,
          },
        },
        {
          headers: {
            ...this.headers,
            'Content-Type': 'application/json',
            'x-restli-method': 'create',
          },
          timeout: 15000,
        }
      );

      this.store.markReplied('linkedin', post.id);
      logger.info(`✅ LinkedIn reply sent | ${post.author} | ${post.id}`);
      logger.info(`   Category: ${category}`);
      logger.info(`   Reply: ${replyText.substring(0, 120)}...`);

      // Pause longue (60-180 sec) — LinkedIn détecte les patterns non-humains
      await this._sleep(60000 + Math.random() * 120000);
      return true;
    } catch (err) {
      logger.error(`LinkedIn reply error (${post.id}): ${err.message}`);

      if (err.response?.status === 401 || err.response?.status === 403) {
        logger.error('LinkedIn: auth failed on reply — cookie expired');
        this.enabled = false;
      }
      if (err.response?.status === 429) {
        logger.warn('LinkedIn: rate limit on reply — pausing 15 minutes');
        await this._sleep(900000);
      }
      if (err.response?.status === 404) {
        this.store.markReplied('linkedin', post.id);
      }

      return false;
    }
  }

  // ============================================================
  //  SESSION & HELPERS
  // ============================================================

  async _checkSession() {
    try {
      const res = await axios.get(
        'https://www.linkedin.com/voyager/api/me',
        { headers: this.headers, timeout: 10000 }
      );

      // Différentes structures possibles selon la version
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
      logger.error(`LinkedIn session check failed: ${err.response?.status || err.message}`);
      return false;
    }
  }

  _extractActivityUrn(postUrn) {
    if (!postUrn) return null;
    if (postUrn.includes('activity:')) return postUrn;
    if (postUrn.includes('ugcPost:')) return postUrn;
    const match = postUrn.match(/(\d{10,})/);
    if (match) return `urn:li:activity:${match[1]}`;
    return null;
  }

  _isRelevant(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    const allKeywords = [
      ...config.keywords.primary,
      ...config.keywords.secondary,
      ...config.keywords.pain_points,
    ];
    return allKeywords.some((kw) => lower.includes(kw.toLowerCase()));
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = LinkedInScanner;
