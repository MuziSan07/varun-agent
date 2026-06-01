// -----------------------------------------------------------------------------
// Claude (Anthropic) client — the agent brain.
// Lazily constructed so an empty API key never crashes startup.
// -----------------------------------------------------------------------------
import Anthropic from '@anthropic-ai/sdk';
import { config, assertConfigured } from '../config.js';
import { logger } from '../logger.js';

let client = null;

export function getClient() {
  assertConfigured('claude');
  if (!client) {
    client = new Anthropic({ apiKey: config.anthropic.apiKey });
  }
  return client;
}

// Used by the dashboard "Test connection" button.
export async function testConnection() {
  try {
    assertConfigured('claude');
  } catch (err) {
    return { ok: false, error: err.message };
  }
  try {
    const c = getClient();
    const res = await c.messages.create({
      model: config.anthropic.model,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
    });
    const text = res.content?.[0]?.type === 'text' ? res.content[0].text.trim() : '';
    return { ok: true, detail: `Model ${config.anthropic.model} responded: "${text}"` };
  } catch (err) {
    logger.error('claude', 'Test connection failed', { error: err.message });
    return { ok: false, error: err.message };
  }
}

// Thin pass-through used by the agent loop (keeps SDK usage in one place).
export async function createMessage(params) {
  const c = getClient();
  return c.messages.create({ model: config.anthropic.model, ...params });
}
