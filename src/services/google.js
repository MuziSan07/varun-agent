// -----------------------------------------------------------------------------
// Google / Gmail integration (server-side OAuth).
//
// WHY SERVER-SIDE: doing Google OAuth inside Expo Go is unreliable (redirect
// restrictions). Instead the app opens our server's /auth/google URL in a
// browser; Google redirects back to our HTTPS callback; we store the refresh
// token. Gmail read/send then run here on the server using that token. This is
// the same model as notes — the app just shows the result.
//
// Single-client app: we store ONE Google account (keyed in settings). Multi-user
// later = key by owner id.
//
// No heavy SDK: we talk to Google's REST endpoints with fetch.
// -----------------------------------------------------------------------------
import { config } from '../config.js';
import { logger } from '../logger.js';
import { getSetting, setSetting } from '../store/store.js';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'openid',
  'email',
].join(' ');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const SETTING_KEY = 'google_tokens';

function redirectUri() {
  // Must EXACTLY match an Authorized redirect URI in the Google Cloud console.
  const base = (config.publicBaseUrl || `http://localhost:${config.port}`).replace(/\/$/, '');
  return `${base}/auth/google/callback`;
}

export function isConfigured() {
  return !!(config.google.clientId && config.google.clientSecret);
}

export function isConnected() {
  const t = getSetting(SETTING_KEY);
  return !!(t && t.refresh_token);
}

// Build the URL the app opens in a browser for the user to sign in.
export function getAuthUrl() {
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',     // get a refresh_token
    prompt: 'consent',          // force refresh_token even on re-auth
    include_granted_scopes: 'true',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// Exchange the ?code from the callback for tokens; persist the refresh token.
export async function exchangeCode(code) {
  const body = new URLSearchParams({
    code,
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || `Token exchange failed (${res.status})`);

  const existing = getSetting(SETTING_KEY) || {};
  const tokens = {
    refresh_token: data.refresh_token || existing.refresh_token, // Google omits on re-consent sometimes
    access_token: data.access_token,
    expiry: Date.now() + (data.expires_in || 3600) * 1000,
  };
  setSetting(SETTING_KEY, tokens);
  logger.info('google', 'Gmail connected (tokens stored)');
  return tokens;
}

// Get a valid access token, refreshing if needed.
async function getAccessToken() {
  const t = getSetting(SETTING_KEY);
  if (!t || !t.refresh_token) throw new Error('Gmail not connected. Tap "Connect Gmail" in the app first.');
  if (t.access_token && t.expiry && Date.now() < t.expiry - 60000) return t.access_token;

  const body = new URLSearchParams({
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    refresh_token: t.refresh_token,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Token refresh failed');
  setSetting(SETTING_KEY, { ...t, access_token: data.access_token, expiry: Date.now() + (data.expires_in || 3600) * 1000 });
  return data.access_token;
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

// List messages newer than `days` (default 1 = today-ish). Returns [{from,subject,snippet,date}].
export async function listRecent({ days = 1, max = 10 } = {}) {
  const token = await getAccessToken();
  const q = encodeURIComponent(`newer_than:${days}d -in:chats`);
  const listRes = await fetch(`${GMAIL}/messages?q=${q}&maxResults=${max}`, { headers: authHeader(token) });
  const list = await listRes.json();
  if (!listRes.ok) throw new Error(list.error?.message || 'Gmail list failed');
  const ids = (list.messages || []).map((m) => m.id);

  const out = [];
  for (const id of ids) {
    const mRes = await fetch(
      `${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      { headers: authHeader(token) },
    );
    const m = await mRes.json();
    if (!mRes.ok) continue;
    const headers = Object.fromEntries((m.payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value]));
    out.push({
      from: headers.from || '(unknown sender)',
      subject: headers.subject || '(no subject)',
      snippet: (m.snippet || '').slice(0, 140),
      date: headers.date || '',
    });
  }
  return out;
}

// Send an email via Gmail. Returns { id }.
export async function sendEmail({ to, subject, body }) {
  const token = await getAccessToken();
  const raw = buildRawMessage({ to, subject, body });
  const res = await fetch(`${GMAIL}/messages/send`, {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Gmail send failed');
  logger.info('google', 'Email sent', { to });
  return { id: data.id };
}

// Build an RFC-2822 message, base64url-encoded (Gmail requirement).
function buildRawMessage({ to, subject, body }) {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
    '',
    body,
  ];
  const msg = lines.join('\r\n');
  return Buffer.from(msg, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function disconnect() {
  setSetting(SETTING_KEY, {});
  return true;
}

export async function testConnection() {
  if (!isConfigured()) return { ok: false, error: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set.' };
  if (!isConnected()) return { ok: false, error: 'Configured, but no account connected yet. Tap "Connect Gmail" in the app.' };
  try {
    const mails = await listRecent({ days: 1, max: 1 });
    return { ok: true, detail: `Gmail connected. ${mails.length ? 'Inbox reachable.' : 'No recent mail, but auth works.'}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
