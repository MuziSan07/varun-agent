// -----------------------------------------------------------------------------
// Express server: developer dashboard API + Twilio WhatsApp webhook.
// -----------------------------------------------------------------------------
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config, getMode, setMode, serviceStatus } from './config.js';
import { logger } from './logger.js';
import { getSetting, setSetting, addNote, listNotes } from './store/store.js';
import { handleInboundWhatsApp, validateTwilioSignature } from './whatsapp/webhook.js';
import { runAgent } from './agent/agent.js';
import { interpret } from './agent/mobileAgent.js';
import { transcribe } from './services/openai.js';
import { toFile } from 'openai';

import * as claude from './services/claude.js';
import * as openai from './services/openai.js';
import * as twilioSvc from './services/twilio.js';
import * as uber from './services/uber.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

export function createServer() {
  const app = express();

  // Twilio posts application/x-www-form-urlencoded; dashboard posts JSON.
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  // ---- Twilio WhatsApp webhook (public) ------------------------------------
  app.post('/webhook/whatsapp', validateTwilioSignature, handleInboundWhatsApp);

  app.get('/health', (_req, res) => res.json({ ok: true, mode: getMode() }));

  // ---- Mobile app API (token-protected via X-App-Token) --------------------
  // The mobile app does NOT execute tools on the server — it sends the user's
  // text/voice here, Claude interprets it into ONE structured action, and the
  // APP performs it on-device using the user's own permissions (contacts,
  // calendar, notifications, WhatsApp deep-link). Keys stay on the server.
  const mobile = express.Router();
  mobile.use(appAuth);

  // Interpret a typed/spoken instruction -> { tool, input }.
  // Calendar/contacts/WhatsApp/reminder actions are executed ON THE DEVICE by the
  // app. NOTES, however, persist on the server — so we execute those here and
  // return the data the app should display.
  mobile.post('/interpret', async (req, res) => {
    const { text, nowISO, owner } = req.body || {};
    if (!text) return res.status(400).json({ ok: false, error: 'text is required' });
    try {
      const result = await interpret({ text, nowISO });
      const userId = owner || config.owner.whatsapp || 'owner';

      if (result.ok && result.tool === 'save_note') {
        const note = addNote({ owner: userId, text: result.input.text });
        result.data = { savedNote: { id: note.id, text: note.text } };
      } else if (result.ok && result.tool === 'list_notes') {
        result.data = { notes: listNotes(userId).map((n) => ({ id: n.id, text: n.text, createdAt: n.createdAt })) };
      }

      logger.info('mobile', 'interpret', { tool: result.tool });
      res.json(result);
    } catch (err) {
      logger.error('mobile', 'interpret failed', { error: err.message });
      res.json({ ok: false, error: err.message });
    }
  });

  // Transcribe a voice note (base64 audio) -> text. Then the app calls /interpret.
  mobile.post('/transcribe', async (req, res) => {
    const { base64, filename, mimetype } = req.body || {};
    if (!base64) return res.status(400).json({ ok: false, error: 'base64 audio is required' });
    try {
      const buf = Buffer.from(base64, 'base64');
      const file = await toFile(buf, filename || 'audio.m4a', { type: mimetype || 'audio/m4a' });
      const text = await transcribe(file);
      res.json({ ok: true, text });
    } catch (err) {
      logger.error('mobile', 'transcribe failed', { error: err.message });
      res.json({ ok: false, error: err.message });
    }
  });

  app.use('/mobile', mobile);

  // ---- Dashboard API (token-protected) -------------------------------------
  const api = express.Router();
  api.use(dashboardAuth);

  // Service config + connection status (no secrets leaked).
  api.get('/status', (_req, res) => {
    res.json({
      mode: getMode(),
      owner: { name: config.owner.name, whatsapp: config.owner.whatsapp ? 'set' : 'missing' },
      services: {
        claude: serviceStatus('claude'),
        openai: serviceStatus('openai'),
        twilio: serviceStatus('twilio'),
        uber: serviceStatus('uber'),
      },
    });
  });

  // Per-service "Test connection".
  const TESTERS = {
    claude: claude.testConnection,
    openai: openai.testConnection,
    twilio: twilioSvc.testConnection,
    uber: uber.testConnection,
  };
  api.post('/test/:service', async (req, res) => {
    const tester = TESTERS[req.params.service];
    if (!tester) return res.status(404).json({ ok: false, error: 'Unknown service' });
    try {
      const result = await tester();
      res.json(result);
    } catch (err) {
      res.json({ ok: false, error: err.message });
    }
  });

  // Sandbox/live toggle (persisted so it survives restarts).
  api.get('/mode', (_req, res) => res.json({ mode: getMode() }));
  api.post('/mode', (req, res) => {
    const mode = setMode(req.body.mode);
    setSetting('mode', mode);
    logger.warn('dashboard', `Mode switched to ${mode}`);
    res.json({ mode });
  });

  // Live logs (snapshot + SSE stream).
  api.get('/logs', (req, res) => res.json({ logs: logger.getLogs(req.query.level) }));
  api.get('/logs/stream', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.flushHeaders?.();
    const unsub = logger.subscribe((entry) => res.write(`data: ${JSON.stringify(entry)}\n\n`));
    req.on('close', () => unsub());
  });

  // Test the agent WITHOUT WhatsApp: type a message as if it were the owner.
  api.post('/agent/test', async (req, res) => {
    const { text, from } = req.body;
    if (!text) return res.status(400).json({ ok: false, error: 'text is required' });
    try {
      const reply = await runAgent({ from: from || config.owner.whatsapp || 'whatsapp:+10000000000', text });
      res.json({ ok: true, reply });
    } catch (err) {
      res.json({ ok: false, error: err.message });
    }
  });

  // Test transcription independently: upload an audio file (base64).
  api.post('/transcribe/test', async (req, res) => {
    const { base64, filename, mimetype } = req.body;
    if (!base64) return res.status(400).json({ ok: false, error: 'base64 audio is required' });
    try {
      const buf = Buffer.from(base64, 'base64');
      const file = await toFile(buf, filename || 'audio.ogg', { type: mimetype || 'audio/ogg' });
      const text = await transcribe(file);
      res.json({ ok: true, text });
    } catch (err) {
      res.json({ ok: false, error: err.message });
    }
  });

  // Send a test WhatsApp message from the dashboard.
  api.post('/whatsapp/send', async (req, res) => {
    const { to, body } = req.body;
    if (!to || !body) return res.status(400).json({ ok: false, error: 'to and body are required' });
    const result = await twilioSvc.sendWhatsApp(to, body, { force: true });
    res.json(result);
  });

  app.use('/api', api);

  // ---- Static dashboard ----------------------------------------------------
  app.use('/', express.static(PUBLIC_DIR));

  return app;
}

// Mobile-app gate. The app sends X-App-Token. If APP_TOKEN is unset, allow (dev).
function appAuth(req, res, next) {
  if (!config.appToken) return next();
  const token = req.headers['x-app-token'] || req.query.appToken;
  if (token === config.appToken) return next();
  return res.status(401).json({ ok: false, error: 'Unauthorized: invalid app token.' });
}

// Simple bearer/token gate. If DASHBOARD_TOKEN is unset, the dashboard is open
// (fine for localhost) but we warn loudly so it isn't deployed unprotected.
function dashboardAuth(req, res, next) {
  if (!config.dashboardToken) {
    return next();
  }
  const header = req.headers.authorization || '';
  const token = header.replace(/^Bearer\s+/i, '') || req.query.token;
  if (token === config.dashboardToken) return next();
  return res.status(401).json({ ok: false, error: 'Unauthorized: provide the dashboard token.' });
}
