// -----------------------------------------------------------------------------
// Thin client for the backend /mobile API.
// -----------------------------------------------------------------------------
import { BACKEND_URL, APP_TOKEN } from './config.js';

async function post(path, body) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-App-Token': APP_TOKEN,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ ok: false, error: 'Bad server response' }));
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
