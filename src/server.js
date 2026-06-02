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
import * as google from './services/google.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

export function createServer() {
  const app = express();

  // Twilio posts application/x-www-form-urlencoded; dashboard/app post JSON.
  // Raise the JSON limit to 25mb: the mobile app uploads base64-encoded voice
  // notes, which far exceed the 100kb express default (caused "Bad server
  // response" on voice). 25mb comfortably covers a minute+ of audio.
  app.use(express.urlencoded({ extended: false, limit: '25mb' }));
  app.use(express.json({ limit: '25mb' }));

  // ---- Twilio WhatsApp webhook (public) ------------------------------------
  app.post('/webhook/whatsapp', validateTwilioSignature, handleInboundWhatsApp);

  app.get('/health', (_req, res) => res.json({ ok: true, mode: getMode() }));

  // ---- Google OAuth (Gmail) ------------------------------------------------
  // The app opens /auth/google?appToken=... in a browser. We redirect to Google;
  // Google redirects back to /auth/google/callback; we store the refresh token
  // and show a "you can return to the app" page.
  app.get('/auth/google', (req, res) => {
    if (!google.isConfigured()) {
      return res.status(500).send('Gmail is not configured on the server (GOOGLE_CLIENT_ID/SECRET missing).');
    }
    res.redirect(google.getAuthUrl());
  });

  app.get('/auth/google/callback', async (req, res) => {
    const { code, error } = req.query;
    if (error) return res.send(authPage(`Google sign-in was cancelled (${error}).`, false));
    if (!code) return res.send(authPage('No authorization code returned.', false));
    try {
      await google.exchangeCode(code);
      res.send(authPage('✅ Gmail connected! You can close this tab and return to the app.', true));
    } catch (err) {
      logger.error('google', 'OAuth callback failed', { error: err.message });
      res.send(authPage(`Sign-in failed: ${err.message}`, false));
    }
  });

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
      } else if (result.ok && result.tool === 'check_email') {
        if (!google.isConnected()) {
          result.data = { needsGmail: true };
        } else {
          try {
            const mails = await google.listRecent({ days: result.input.days || 1, max: 10 });
            result.data = { emails: mails };
          } catch (err) {
            result.data = { emailError: err.message };
          }
        }
      } else if (result.ok && result.tool === 'read_email') {
        if (!google.isConnected()) {
          result.data = { needsGmail: true };
        } else {
          try {
            result.data = { email: await google.readEmail({ query: result.input.query }) };
          } catch (err) {
            result.data = { emailError: err.message };
          }
        }
      } else if (result.ok && result.tool === 'send_email') {
        // If the recipient is already an email address, the server sends it now.
        // If it's a NAME, tell the app to resolve the contact's email and call
        // /mobile/send-email. (Contacts live on the device.)
        const to = String(result.input.to || '');
        if (!google.isConnected()) {
          result.data = { needsGmail: true };
        } else if (/\S+@\S+\.\S+/.test(to)) {
          try {
            await google.sendEmail({ to, subject: result.input.subject, body: result.input.body });
            result.data = { emailSent: { to } };
          } catch (err) {
            result.data = { emailError: err.message };
          }
        } else {
          result.data = { resolveContactEmail: { name: to, subject: result.input.subject, body: result.input.body } };
        }
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

  // Gmail connection status for the app (shows "Connect Gmail" if not linked).
  mobile.get('/gmail-status', (_req, res) => {
    res.json({ ok: true, configured: google.isConfigured(), connected: google.isConnected() });
  });

  // ---- Settings: Gmail credentials (entered by the client in the app) -------
  // Returns masked status (never the secret) + the exact redirect URI to paste
  // into Google Cloud Console.
  mobile.get('/settings/gmail', (_req, res) => {
    res.json({ ok: true, ...google.credsStatus(), connected: google.isConnected() });
  });

  // Save the client's own Client ID + Secret.
  mobile.post('/settings/gmail', (req, res) => {
    const { clientId, clientSecret } = req.body || {};
    if (!clientId) return res.status(400).json({ ok: false, error: 'clientId is required' });
    google.setCreds({ clientId: clientId.trim(), clientSecret: (clientSecret || '').trim() });
    res.json({ ok: true, ...google.credsStatus() });
  });

  // Disconnect the linked Gmail account (keeps creds, drops tokens).
  mobile.post('/settings/gmail/disconnect', (_req, res) => {
    google.disconnect();
    res.json({ ok: true });
  });

  // Send an email to a resolved address. Used when the agent named a CONTACT and
  // the app looked up that contact's email on the device.
  mobile.post('/send-email', async (req, res) => {
    const { to, subject, body } = req.body || {};
    if (!to || !subject || body === undefined) {
      return res.status(400).json({ ok: false, error: 'to, subject, body required' });
    }
    if (!google.isConnected()) return res.json({ ok: false, error: 'Gmail not connected.' });
    try {
      await google.sendEmail({ to, subject, body });
      res.json({ ok: true });
    } catch (err) {
      logger.error('mobile', 'send-email failed', { error: err.message });
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
    gmail: google.testConnection,
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

// Minimal HTML page shown after the Google OAuth redirect.
function authPage(message, ok) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gmail connection</title>
<style>body{font-family:system-ui;background:#0f1115;color:#e7e9ee;display:flex;align-items:center;
justify-content:center;height:100vh;margin:0;text-align:center;padding:24px}
.card{background:#171a21;border:1px solid #2a2f3a;border-radius:14px;padding:28px;max-width:360px}
.ok{color:#25d366}.err{color:#ef4444}</style></head>
<body><div class="card"><h2 class="${ok ? 'ok' : 'err'}">${ok ? 'Success' : 'Problem'}</h2>
<p>${message}</p></div></body></html>`;
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
