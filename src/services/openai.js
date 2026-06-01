// -----------------------------------------------------------------------------
// OpenAI client — voice-note transcription (Whisper).
//
// HINGLISH STRATEGY (the hardest input case) — see README for full rationale:
//  1. We DO NOT force `language`. Whisper auto-detects; forcing "hi" mangles the
//     English words common in Hinglish and vice-versa.
//  2. We pass a `prompt` priming Whisper that the speaker mixes Hindi + English
//     (code-switching) and may use Roman or Devanagari script. This measurably
//     improves code-switched output.
//  3. We keep transcription SEPARATE and INDEPENDENTLY TESTABLE (see the dev UI
//     and tests). The agent then interprets the transcript — Claude is strong at
//     understanding Hinglish text even when transcription is imperfect.
// -----------------------------------------------------------------------------
import OpenAI from 'openai';
import { config, assertConfigured } from '../config.js';
import { logger } from '../logger.js';

let client = null;

export function getClient() {
  assertConfigured('openai');
  if (!client) {
    client = new OpenAI({ apiKey: config.openai.apiKey });
  }
  return client;
}

const HINGLISH_PROMPT =
  'The audio is a casual personal-assistant request. The speaker may code-switch ' +
  'between English and Hindi (Hinglish), in Roman or Devanagari script. ' +
  'Names of people, cities, and places may be Indian.';

// Transcribe an audio buffer/stream. `file` must be a Web File / Blob / stream
// accepted by the OpenAI SDK (we build one in the webhook from the media bytes).
export async function transcribe(file) {
  const c = getClient();
  const res = await c.audio.transcriptions.create({
    model: config.openai.transcribeModel,
    file,
    prompt: HINGLISH_PROMPT,
    // language intentionally omitted -> auto-detect (see strategy above).
    temperature: 0,
  });
  return res.text;
}

export async function testConnection() {
  try {
    assertConfigured('openai');
  } catch (err) {
    return { ok: false, error: err.message };
  }
  try {
    const c = getClient();
    // Cheapest reliable auth check: list models.
    const models = await c.models.list();
    const count = models.data?.length ?? 0;
    return { ok: true, detail: `Authenticated. ${count} models available.` };
  } catch (err) {
    logger.error('openai', 'Test connection failed', { error: err.message });
    return { ok: false, error: err.message };
  }
}
