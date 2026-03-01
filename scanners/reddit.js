const Snoowrap = require('snoowrap');
const config = require('../config');
const logger = require('../logger');
const ReplyGenerator = require('../replyGenerator');

class RedditScanner {
  constructor(store) {
    this.store = store; // shared store for already-replied post IDs
    this.replyGen = new ReplyGenerator();
    this.enabled = !!(
      process.env.REDDIT_CLIENT_ID &&
      process.env.REDDIT_CLIENT_SECRET &&
      process.env.REDDIT_USERNAME &&
      process.env.REDDIT_PASSWORD
    );

    if (this.enabled) {
      this.reddit = new Snoowrap({
        userAgent: 'TaskerTimeBot/1.0 (social listening)',
        clientId: process.env.REDDIT_CLIENT_ID,
        clientSecret: process.env.REDDIT_CLIENT_SECRET,
        username: process.env.REDDIT_USERNAME,
        password: process.env.REDDIT_PASSWORD,
      });
      this.reddit.config({ requestDelay: 1500, continueAfterRatelimitError: true });
      logger.info('Reddit scanner initialized');
    } else {
      logger.warn('Reddit scanner disabled — missing credentials');
    }
  }

  async scan() {
    if (!this.enabled) return [];

    const results = [];

    // 1. Scan par subreddit (nouveaux posts)
    for (const sub of config.subreddits) {
      try {
        const posts = await this.reddit.getSubreddit(sub).getNew({ limit: 25 });
        for (const post of posts) {
          if (this._isRelevant(post.title + ' ' + (post.selftext || ''))) {
            if (!this.store.hasReplied('reddit', post.id)) {
              results.push({
                id: post.id,
                platform: 'reddit',
                subreddit: sub,
                title: post.title,
                content: post.selftext || '',
                author: post.author.name,
                url: `https://reddit.com${post.permalink}`,
                created: new Date(post.created_utc * 1000),
              });
            }
          }
        }
        // Rate limiting
        await this._sleep(2000);
      } catch (err) {
        logger.error(`Reddit scan error (r/${sub}): ${err.message}`);
      }
    }

    // 2. Recherche globale par mots-clés
    const allKeywords = [
      ...config.keywords.primary,
      ...config.keywords.pain_points.slice(0, 5),
    ];

    for (const keyword of allKeywords) {
      try {
        const searchResults = await this.reddit.search({
          query: keyword,
          sort: 'new',
          time: 'day',
          limit: 10,
        });

        for (const post of searchResults) {
          if (!this.store.hasReplied('reddit', post.id)) {
            results.push({
              id: post.id,
              platform: 'reddit',
              subreddit: post.subreddit.display_name,
              title: post.title,
              content: post.selftext || '',
              author: post.author.name,
              url: `https://reddit.com${post.permalink}`,
              created: new Date(post.created_utc * 1000),
            });
          }
        }
        await this._sleep(2000);
      } catch (err) {
        logger.error(`Reddit search error (${keyword}): ${err.message}`);
      }
    }

    // Déduplique
    const unique = [...new Map(results.map((r) => [r.id, r])).values()];
    logger.info(`Reddit: found ${unique.length} relevant posts`);
    return unique;
  }

  async reply(post) {
    if (!this.enabled) return false;

    try {
      const category = config.categorizePost(post.title + ' ' + post.content);
      const replyText = await this.replyGen.generateReply(
        post.title + '\n' + post.content,
        'reddit',
        category
      );

      // Post the reply
      const submission = await this.reddit.getSubmission(post.id);
      await submission.reply(replyText);

      this.store.markReplied('reddit', post.id);
      logger.info(
        `✅ Reddit reply sent | r/${post.subreddit} | ${post.id} | category: ${category}`
      );
      logger.info(`   Reply: ${replyText.substring(0, 100)}...`);

      // Respecter les rate limits Reddit
      await this._sleep(10000 + Math.random() * 5000);
      return true;
    } catch (err) {
      logger.error(`Reddit reply error (${post.id}): ${err.message}`);
      // Si rate limited, on attend plus longtemps
      if (err.message.includes('RATELIMIT')) {
        logger.warn('Reddit rate limit hit — waiting 10 minutes');
        await this._sleep(600000);
      }
      return false;
    }
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

module.exports = RedditScanner;
