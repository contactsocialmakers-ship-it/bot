const axios = require('axios');
const cheerio = require('cheerio');
const config = require('../config');
const logger = require('../logger');

class WebScanner {
  constructor(store) {
    this.store = store;
    this.sources = [
      {
        name: 'Freelance-info Forum',
        searchUrl: 'https://www.freelance-info.fr/search?q=',
        baseUrl: 'https://www.freelance-info.fr',
      },
      {
        name: 'Journal du Net Forum',
        searchUrl: 'https://www.journaldunet.com/search/?q=',
        baseUrl: 'https://www.journaldunet.com',
      },
      {
        name: 'Comment ça marche Forum',
        searchUrl: 'https://www.commentcamarche.net/search/?q=',
        baseUrl: 'https://www.commentcamarche.net',
      },
    ];

    logger.info('Web scanner initialized');
  }

  async scan() {
    const results = [];
    const searchTerms = config.keywords.primary.slice(0, 5);

    for (const source of this.sources) {
      for (const term of searchTerms) {
        try {
          const url = `${source.searchUrl}${encodeURIComponent(term)}`;
          const res = await axios.get(url, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              Accept: 'text/html,application/xhtml+xml',
              'Accept-Language': 'fr-FR,fr;q=0.9',
            },
            timeout: 10000,
          });

          const $ = cheerio.load(res.data);

          // Extraction générique — s'adapte aux structures communes
          $('a[href*="forum"], a[href*="topic"], a[href*="discussion"]').each((_, el) => {
            const title = $(el).text().trim();
            const href = $(el).attr('href');
            const fullUrl = href?.startsWith('http') ? href : `${source.baseUrl}${href}`;
            const id = `web_${Buffer.from(fullUrl).toString('base64').substring(0, 20)}`;

            if (title && href && this._isRelevant(title) && !this.store.hasReplied('web', id)) {
              results.push({
                id,
                platform: 'web',
                source: source.name,
                title: title.substring(0, 200),
                content: title,
                url: fullUrl,
                created: new Date(),
              });
            }
          });

          await this._sleep(3000);
        } catch (err) {
          logger.error(`Web scan error (${source.name}): ${err.message}`);
        }
      }
    }

    const unique = [...new Map(results.map((r) => [r.id, r])).values()];
    logger.info(`Web: found ${unique.length} relevant forum posts`);
    return unique;
  }

  // Le web scanner ne fait que de la détection — les réponses forum sont manuelles
  // On log les opportunités pour que tu puisses intervenir
  async reply(post) {
    logger.info(`📌 WEB OPPORTUNITY | ${post.source} | ${post.url}`);
    logger.info(`   Title: ${post.title}`);
    this.store.markReplied('web', post.id);
    return true; // Marked as handled
  }

  _isRelevant(text) {
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

module.exports = WebScanner;
