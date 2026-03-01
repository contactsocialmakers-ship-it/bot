require('dotenv').config();
const cron = require('node-cron');
const logger = require('./logger');
const Store = require('./store');
const LinkedInScanner = require('./scanners/linkedin');

// ============================================================
//  TASKERTIME — LINKEDIN SOCIAL LISTENING BOT
//  Scanne LinkedIn 24/7, répond automatiquement aux posts
//  pertinents avec des messages contextuels.
// ============================================================

class TaskerTimeBot {
  constructor() {
    this.store = new Store();
    this.linkedin = new LinkedInScanner(this.store);
    this.isRunning = false;
    this.cycleCount = 0;
  }

  // ============================================================
  //  SCAN CYCLE — exécuté toutes les X minutes
  // ============================================================
  async runCycle() {
    if (this.isRunning) {
      logger.warn('Cycle already running — skip');
      return;
    }

    this.isRunning = true;
    this.cycleCount++;
    const start = Date.now();

    logger.info(`\n========== CYCLE #${this.cycleCount} ==========`);

    try {
      // Check quotas
      if (!this.store.canReplyToday()) {
        logger.info('Daily reply limit reached — scanning only (no replies)');
      }

      // Phase 1 : Scanner LinkedIn
      const posts = await this.linkedin.scan();

      if (posts.length === 0) {
        logger.info('No new relevant posts found');
        return;
      }

      logger.info(`${posts.length} posts à traiter (triés par score)`);

      // Phase 2 : Répondre aux posts (dans l'ordre du score)
      let replied = 0;
      let skipped = 0;
      let errors = 0;

      for (const post of posts) {
        // Vérifier la limite quotidienne
        if (!this.store.canReplyToday()) {
          logger.info(`Daily limit reached after ${replied} replies`);
          break;
        }

        try {
          logger.info(
            `Processing: score=${post.score} | cat=${post.category} | "${post.text.substring(0, 80)}..."`
          );

          const success = await this.linkedin.reply(post);

          if (success) {
            replied++;
          } else {
            skipped++;
          }
        } catch (err) {
          errors++;
          logger.error(`Reply error: ${err.message}`);
        }

        // Pause humaine entre chaque réponse (45s - 3min)
        // LinkedIn détecte les patterns mécaniques
        const pause = 45000 + Math.random() * 135000;
        logger.info(`Pause ${(pause / 1000).toFixed(0)}s before next reply...`);
        await this._sleep(pause);
      }

      // Phase 3 : Stats
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const stats = this.store.getStats();

      logger.info(`---------- CYCLE #${this.cycleCount} DONE ----------`);
      logger.info(`Duration: ${elapsed}s`);
      logger.info(`Found: ${posts.length} | Replied: ${replied} | Skipped: ${skipped} | Errors: ${errors}`);
      logger.info(`Today: ${stats.todayReplies}/${stats.maxRepliesToday} replies | ${stats.todaySearches}/${stats.maxSearchesToday} searches`);
      logger.info(`Lifetime: ${stats.totalReplies} replies | ${stats.totalScans} scans`);
    } catch (err) {
      logger.error(`Cycle failed: ${err.message}`);
    } finally {
      this.isRunning = false;
    }
  }

  // ============================================================
  //  START — lance le bot en continu
  // ============================================================
  async start() {
    const interval = parseInt(process.env.SCAN_INTERVAL_MINUTES) || 10;
    const isDryRun = process.env.DRY_RUN === 'true';

    logger.info('╔══════════════════════════════════════════════╗');
    logger.info('║   TASKERTIME LINKEDIN BOT — STARTING         ║');
    logger.info('╚══════════════════════════════════════════════╝');
    logger.info(`Mode: ${isDryRun ? '🧪 DRY RUN (no real replies)' : '🔴 LIVE (replies enabled)'}`);
    logger.info(`Scan interval: every ${interval} min`);
    logger.info(`URL: ${process.env.TASKERTIME_URL || 'https://taskertime.app'}`);
    logger.info(`AI replies: ${process.env.ANTHROPIC_API_KEY ? 'ENABLED' : 'DISABLED'}`);
    logger.info(`Max replies/day: ${process.env.MAX_REPLIES_PER_DAY || 20}`);
    logger.info(`Max searches/day: ${process.env.MAX_SEARCHES_PER_DAY || 50}`);

    // Vérifier la session LinkedIn
    const sessionOk = await this.linkedin.checkSession();
    if (!sessionOk) {
      logger.error('LinkedIn session invalid — fix your li_at cookie and restart');
      logger.error('Steps: Chrome → linkedin.com → F12 → Application → Cookies → copy li_at');
      // On continue quand même, le bot retestera à chaque cycle
    }

    // Dashboard HTTP — DOIT démarrer en premier pour Railway
    this._startDashboard();

    // Premier cycle après 5s (laisse le serveur HTTP démarrer)
    setTimeout(() => this.runCycle(), 5000);

    // Cycles réguliers
    cron.schedule(`*/${interval} * * * *`, () => this.runCycle());

    // Nettoyage quotidien à 4h du matin
    cron.schedule('0 4 * * *', () => {
      logger.info('Daily cleanup...');
      this.store.cleanup();
    });

    // Vérification session toutes les 6h
    cron.schedule('0 */6 * * *', () => {
      logger.info('Session health check...');
      this.linkedin.checkSession();
    });

    logger.info(`Bot running 24/7. Next scan in ${interval} min.`);
  }

  // ============================================================
  //  DASHBOARD — stats en temps réel
  // ============================================================
  _startDashboard() {
    const http = require('http');
    const port = process.env.PORT || 3000;

    const server = http.createServer((req, res) => {
      const stats = this.store.getStats();

      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(
          JSON.stringify({
            status: 'running',
            linkedin: this.linkedin.enabled ? 'active' : 'expired',
            cycle: this.cycleCount,
            scanning: this.isRunning,
            ...stats,
          })
        );
      }

      // Dashboard HTML
      const isDryRun = process.env.DRY_RUN === 'true';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>TaskerTime Bot</title>
  <meta http-equiv="refresh" content="30">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #0a0a1a; color: #e0e0e0; padding: 40px; }
    h1 { color: #00d4aa; font-size: 24px; margin-bottom: 8px; }
    .mode { display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 13px;
            font-weight: 600; margin-bottom: 24px;
            background: ${isDryRun ? '#2d2000' : '#1a0000'}; 
            color: ${isDryRun ? '#ffaa00' : '#ff4444'}; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px; margin-bottom: 32px; }
    .card { background: #111128; border: 1px solid #1e1e3a; border-radius: 8px; padding: 20px; }
    .card .label { font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 1px; }
    .card .value { font-size: 32px; font-weight: 700; color: #00d4aa; margin-top: 4px; }
    .card .sub { font-size: 12px; color: #555; margin-top: 4px; }
    .status { display: inline-block; width: 8px; height: 8px; border-radius: 50%;
              margin-right: 6px; animation: pulse 2s infinite; }
    .status.ok { background: #00d4aa; }
    .status.warn { background: #ffaa00; }
    .status.err { background: #ff4444; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .footer { margin-top: 32px; color: #333; font-size: 12px; }
  </style>
</head>
<body>
  <h1>TaskerTime LinkedIn Bot</h1>
  <div class="mode">${isDryRun ? '🧪 DRY RUN' : '🔴 LIVE'}</div>

  <div class="grid">
    <div class="card">
      <div class="label">Status</div>
      <div class="value" style="font-size:18px">
        <span class="status ${this.linkedin.enabled ? (this.isRunning ? 'ok' : 'ok') : 'err'}"></span>
        ${this.isRunning ? 'Scanning...' : this.linkedin.enabled ? 'Idle' : 'Session Expired'}
      </div>
    </div>
    <div class="card">
      <div class="label">Replies Today</div>
      <div class="value">${stats.todayReplies}</div>
      <div class="sub">/ ${stats.maxRepliesToday} max</div>
    </div>
    <div class="card">
      <div class="label">Searches Today</div>
      <div class="value">${stats.todaySearches}</div>
      <div class="sub">/ ${stats.maxSearchesToday} max</div>
    </div>
    <div class="card">
      <div class="label">Total Replies</div>
      <div class="value">${stats.totalReplies}</div>
      <div class="sub">lifetime</div>
    </div>
    <div class="card">
      <div class="label">Total Scans</div>
      <div class="value">${stats.totalScans}</div>
    </div>
    <div class="card">
      <div class="label">Cycle</div>
      <div class="value">#${this.cycleCount}</div>
    </div>
    <div class="card">
      <div class="label">Posts Tracked</div>
      <div class="value">${stats.totalTracked}</div>
      <div class="sub">never reply twice</div>
    </div>
    <div class="card">
      <div class="label">Last Scan</div>
      <div class="value" style="font-size:14px">${stats.lastScanAt ? new Date(stats.lastScanAt).toLocaleString('fr-FR') : 'Never'}</div>
    </div>
  </div>

  <div class="footer">
    Auto-refresh every 30s | Uptime since ${new Date(stats.startedAt).toLocaleString('fr-FR')}
  </div>
</body>
</html>`);
    });

    server.listen(port, () => logger.info(`Dashboard: http://localhost:${port}`));
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================
//  LAUNCH
// ============================================================
const bot = new TaskerTimeBot();
bot.start();

process.on('SIGTERM', () => {
  logger.info('SIGTERM — shutdown');
  process.exit(0);
});
process.on('SIGINT', () => {
  logger.info('SIGINT — shutdown');
  process.exit(0);
});
process.on('uncaughtException', (err) => {
  logger.error(`Uncaught: ${err.message}\n${err.stack}`);
});
process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled: ${reason}`);
});
