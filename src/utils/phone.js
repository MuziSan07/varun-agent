// -----------------------------------------------------------------------------
// Phone-number helpers and the WhatsApp 24-hour customer-service window check.
// -----------------------------------------------------------------------------
import { lastInboundAt } from '../store/store.js';

// Normalise to E.164-ish: keep leading +, strip spaces/dashes/parentheses.
export function toE164(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/^whatsapp:/i, '').trim();
  s = s.replace(/[\s\-().]/g, '');
  if (!s.startsWith('+')) {
    // If it's all digits without +, we can't safely guess the country code.
    // Return as-is with a + so Twilio can validate; caller should pass E.164.
    if (/^\d{6,15}$/.test(s)) s = `+${s}`;
  }
  return s;
}

export function toWhatsApp(raw) {
  const e164 = toE164(raw);
  if (!e164) return null;
  return e164.startsWith('whatsapp:') ? e164 : `whatsapp:${e164}`;
}

export function isValidE164(raw) {
  const s = toE164(raw);
  return !!s && /^\+\d{6,15}$/.test(s);
}

// True if `number` messaged us within the last 24h (free-form session open).
// Outside this window WhatsApp only permits pre-approved template messages.
export function isWithin24hWindow(number) {
  const last = lastInboundAt(number);
  if (!last) return false;
  const ageMs = Date.now() - new Date(last).getTime();
  return ageMs <= 24 * 60 * 60 * 1000;
}

export function hoursSinceLastInbound(number) {
  const last = lastInboundAt(number);
  if (!last) return Infinity;
  return (Date.now() - new Date(last).getTime()) / (60 * 60 * 1000);
}
