const axios = require('axios');
const config = require('../config');
const logger = require('../logger');
const ReplyGenerator = require('../replyGenerator');

class TwitterScanner {
  constructor(store) {
    this.store = store;
    this.replyGen = new ReplyGenerator();
    this.bearerToken = process.env.TWITTER_BEARER_TOKEN;
    this.enabled = !!this.bearerToken;

    if (this.enabled) {
      logger.info('Twitter scanner initialized');
    } else {
      logger.warn('Twitter scanner disabled — missing TWITTER_BEARER_TOKEN');
    }
  }

  async scan() {
    if (!this.enabled) return [];

    const results = [];
    const queries = [
      // Requêtes en français
      '"facture freelance" OR "facturation auto-entrepreneur" OR "logiciel facturation freelance" lang:fr -is:retweet',
      '"galère facture" OR "galère facturation" OR "cherche outil facturation" lang:fr -is:retweet',
      '"devenir freelance" "facture" lang:fr -is:retweet',
      // Requêtes en anglais
      '"freelance invoice" OR "freelance billing tool" OR "invoice software freelance" -is:retweet',
    ];

    for (const query of queries) {
      try {
        const res = await axios.get('https://api.twitter.com/2/tweets/search/recent', {
          headers: {
            Authorization: `Bearer ${this.bearerToken}`,
          },
          params: {
            query: query,
            max_results: 20,
            'tweet.fields': 'author_id,created_at,conversation_id,text',
            expansions: 'author_id',
            'user.fields': 'username',
          },
        });

        if (res.data.data) {
          const users = {};
          if (res.data.includes?.users) {
            res.data.includes.users.forEach((u) => {
              users[u.id] = u.username;
            });
          }

          for (const tweet of res.data.data) {
            if (!this.store.hasReplied('twitter', tweet.id)) {
              results.push({
                id: tweet.id,
                platform: 'twitter',
                content: tweet.text,
                author: users[tweet.author_id] || tweet.author_id,
                authorId: tweet.author_id,
                conversationId: tweet.conversation_id,
                url: `https://twitter.com/${users[tweet.author_id] || 'i'}/status/${tweet.id}`,
                created: new Date(tweet.created_at),
              });
            }
          }
        }

        await this._sleep(2000);
      } catch (err) {
        if (err.response?.status === 429) {
          logger.warn('Twitter rate limit — waiting 15 minutes');
          await this._sleep(900000);
        } else {
          logger.error(`Twitter scan error: ${err.message}`);
        }
      }
    }

    const unique = [...new Map(results.map((r) => [r.id, r])).values()];
    logger.info(`Twitter: found ${unique.length} relevant tweets`);
    return unique;
  }

  async reply(post) {
    if (!this.enabled) return false;

    try {
      const category = config.categorizePost(post.content);
      let replyText = await this.replyGen.generateReply(post.content, 'twitter', category);

      // Tronquer à 280 caractères pour Twitter
      if (replyText.length > 280) {
        replyText = replyText.substring(0, 277) + '...';
      }

      // Twitter API v2 - post reply
      // Note: requires OAuth 1.0a or OAuth 2.0 with write access
      // The bearer token alone doesn't allow posting — you need user context
      // This is a placeholder for the full OAuth implementation
      const res = await axios.post(
        'https://api.twitter.com/2/tweets',
        {
          text: replyText,
          reply: {
            in_reply_to_tweet_id: post.id,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${this.bearerToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.store.markReplied('twitter', post.id);
      logger.info(`✅ Twitter reply sent | @${post.author} | ${post.id}`);
      logger.info(`   Reply: ${replyText.substring(0, 100)}...`);

      // Twitter est strict sur le rate limiting
      await this._sleep(30000 + Math.random() * 30000);
      return true;
    } catch (err) {
      logger.error(`Twitter reply error (${post.id}): ${err.message}`);
      if (err.response?.status === 429) {
        logger.warn('Twitter rate limit on reply — waiting 15 minutes');
        await this._sleep(900000);
      }
      return false;
    }
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = TwitterScanner;
