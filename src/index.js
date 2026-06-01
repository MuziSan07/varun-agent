// -----------------------------------------------------------------------------
// Entrypoint: start the server + scheduler. Designed to NEVER crash on empty
// keys — it reports what's configured and waits for work.
// -----------------------------------------------------------------------------
import { config, getMode, setMode, serviceStatus } from './config.js';
import { logger } from './logger.js';
import { createServer } from './server.js';
import { startScheduler } from './scheduler/scheduler.js';
import { getSetting } from './store/store.js';

function banner() {
  // Restore persisted mode (dashboard toggle) if present.
  const persisted = getSetting('mode');
  if (persisted) setMode(persisted);

  logger.info('boot', `WhatsApp AI Assistant starting in ${getMode()} mode.`);
  const services = ['claude', 'openai', 'twilio', 'uber'];
  for (const s of services) {
    const { configured, missing } = serviceStatus(s);
    if (configured) logger.info('boot', `✓ ${s} configured`);
    else logger.warn('boot', `✗ ${s} NOT configured — missing: ${missing.join(', ')}`);
  }
  if (!config.owner.whatsapp) {
    logger.warn('boot', 'OWNER_WHATSAPP_NUMBER not set — the agent won\'t know who "me" is for self-reminders.');
  }
  if (!config.dashboardToken) {
    logger.warn('boot', 'DASHBOARD_TOKEN not set — the dashboard is UNPROTECTED. Set it before deploying.');
  }
}

function main() {
  banner();
  const app = createServer();
  app.listen(config.port, () => {
    logger.info('boot', `Dashboard:  http://localhost:${config.port}/`);
    logger.info('boot', `Webhook:    POST /webhook/whatsapp`);
    logger.info('boot', `Health:     GET  /health`);
  });
  startScheduler();
}

// Never let an unexpected error kill the process silently.
process.on('unhandledRejection', (reason) => {
  logger.error('process', 'Unhandled promise rejection', { error: String(reason) });
});
process.on('uncaughtException', (err) => {
  logger.error('process', 'Uncaught exception', { error: err.message });
});

main();
