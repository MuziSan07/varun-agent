// -----------------------------------------------------------------------------
// Thin client for the backend /mobile API.
// -----------------------------------------------------------------------------
import { BACKEND_URL, APP_TOKEN } from './config.js';

async function post(path, body) {
  let res;
  try {
    res = await fetch(`${BACKEND_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-App-Token': APP_TOKEN,
      },
      body: JSON.stringify(body),
    });
  } catch (netErr) {
    throw new Error(`Network error: ${netErr.message}`);
  }

  // Read raw text first so we can surface a useful message even if the server
  // returned a non-JSON error page (e.g. a 413 too-large or 502).
  const raw = await res.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    const snippet = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    throw new Error(`Server ${res.status}: ${snippet || 'non-JSON response'}`);
  }
  if (!res.ok && data.ok === undefined) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

// Send text -> { ok, tool, input }
export function interpret(text) {
  return post('/mobile/interpret', { text, nowISO: new Date().toISOString() });
}

// Send base64 audio -> { ok, text }
export function transcribe(base64, mimetype = 'audio/m4a', filename = 'voice.m4a') {
  return post('/mobile/transcribe', { base64, mimetype, filename });
}

// Send an email to a resolved address (used after looking up a contact's email).
export function sendEmail(to, subject, body) {
  return post('/mobile/send-email', { to, subject, body });
}

// Is Gmail connected on the server? -> { ok, configured, connected }
export async function gmailStatus() {
  const res = await fetch(`${BACKEND_URL}/mobile/gmail-status`, {
    headers: { 'X-App-Token': APP_TOKEN },
  });
  return res.json();
}

// The URL the app opens in a browser to connect Gmail.
export function gmailAuthUrl() {
  return `${BACKEND_URL}/auth/google`;
}

// ---- Settings: Gmail credentials -------------------------------------------
export async function getGmailSettings() {
  const res = await fetch(`${BACKEND_URL}/mobile/settings/gmail`, {
    headers: { 'X-App-Token': APP_TOKEN },
  });
  return res.json();
}

export function saveGmailSettings(clientId, clientSecret) {
  return post('/mobile/settings/gmail', { clientId, clientSecret });
}

export function disconnectGmail() {
  return post('/mobile/settings/gmail/disconnect', {});
}
