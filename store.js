const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const DATA_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'replied.json');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');

class Store {
  constructor() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    this.replied = this._load(STORE_FILE, {});
    this.stats = this._load(STATS_FILE, {
      totalScans: 0,
      totalReplies: 0,
      startedAt: new Date().toISOString(),
      lastScanAt: null,
      dailyReplies: {},
      dailySearches: {},
    });
  }

  _load(file, defaults) {
    try {
      if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (err) {
      logger.error(`Store load error: ${err.message}`);
    }
    return defaults;
  }

  _save(file, data) {
    try {
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (err) {
      logger.error(`Store save error: ${err.message}`);
    }
  }

  _today() {
    return new Date().toISOString().split('T')[0];
  }

  hasReplied(id) {
    return !!this.replied[id];
  }

  markReplied(id, meta = {}) {
    this.replied[id] = { timestamp: new Date().toISOString(), ...meta };
    this._save(STORE_FILE, this.replied);

    this.stats.totalReplies++;
    const today = this._today();
    this.stats.dailyReplies[today] = (this.stats.dailyReplies[today] || 0) + 1;
    this._save(STATS_FILE, this.stats);
  }

  recordScan() {
    this.stats.totalScans++;
    this.stats.lastScanAt = new Date().toISOString();
    const today = this._today();
    this.stats.dailySearches[today] = (this.stats.dailySearches[today] || 0) + 1;
    this._save(STATS_FILE, this.stats);
  }

  getTodayReplies() {
    return this.stats.dailyReplies[this._today()] || 0;
  }

  getTodaySearches() {
    return this.stats.dailySearches[this._today()] || 0;
  }

  canReplyToday() {
    const max = parseInt(process.env.MAX_REPLIES_PER_DAY) || 20;
    return this.getTodayReplies() < max;
  }

  canSearchToday() {
    const max = parseInt(process.env.MAX_SEARCHES_PER_DAY) || 50;
    return this.getTodaySearches() < max;
  }

  getStats() {
    return {
      ...this.stats,
      totalTracked: Object.keys(this.replied).length,
      todayReplies: this.getTodayReplies(),
      todaySearches: this.getTodaySearches(),
      maxRepliesToday: parseInt(process.env.MAX_REPLIES_PER_DAY) || 20,
      maxSearchesToday: parseInt(process.env.MAX_SEARCHES_PER_DAY) || 50,
    };
  }

  // Nettoyage >30 jours
  cleanup() {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    let cleaned = 0;
    for (const [key, val] of Object.entries(this.replied)) {
      if (new Date(val.timestamp) < cutoff) {
        delete this.replied[key];
        cleaned++;
      }
    }
    // Clean old daily stats
    for (const [date] of Object.entries(this.stats.dailyReplies)) {
      if (new Date(date) < cutoff) delete this.stats.dailyReplies[date];
    }
    for (const [date] of Object.entries(this.stats.dailySearches)) {
      if (new Date(date) < cutoff) delete this.stats.dailySearches[date];
    }

    if (cleaned > 0) {
      this._save(STORE_FILE, this.replied);
      this._save(STATS_FILE, this.stats);
      logger.info(`Cleanup: removed ${cleaned} old entries`);
    }
  }
}

module.exports = Store;
