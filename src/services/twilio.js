// -----------------------------------------------------------------------------
// Twilio client — WhatsApp messaging + outbound voice calls.
// Lazily constructed; empty creds never crash startup.
// -----------------------------------------------------------------------------
import twilio from 'twilio';
import { config, assertConfigured, whatsappFrom, isSandbox } from '../config.js';
import { logger } from '../logger.js';
import { toWhatsApp, toE164, isWithin24hWindow } from '../utils/phone.js';

let client = null;

export function getClient() {
  assertConfigured('twilio');
  if (!client) {
    client = twilio(config.twilio.accountSid, config.twilio.authToken);
  }
  return client;
}

// -----------------------------------------------------------------------------
// Send a WhatsApp message, RESPECTING the 24-hour window.
//
// opts:
//   - allowTemplate (bool): if outside the 24h window, send the pre-approved
//     template (TWILIO_TEMPLATE_SID) instead. Requires the SID to be set.
//   - contentVariables (object): variables for the template.
//   - force (bool): bypass the window guard (used for direct replies to an
//     inbound message, which are always inside the window).
//
// Returns { ok, sid?, error?, windowBlocked? }.
// -----------------------------------------------------------------------------
export async function sendWhatsApp(to, body, opts = {}) {
  try {
    assertConfigured('twilio');
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const from = whatsappFrom();
  if (!from) {
    return {
      ok: false,
      error: isSandbox()
        ? 'TWILIO_WHATSAPP_SANDBOX_FROM is not set.'
        : 'TWILIO_WHATSAPP_LIVE_FROM is not set (required for LIVE mode).',
    };
  }

  const toAddr = toWhatsApp(to);
  const within = opts.force || isWithin24hWindow(to);

  // Proactive message outside the 24h window: must use an approved template.
  if (!within) {
    if (opts.allowTemplate && config.twilio.templateSid) {
      return sendTemplate(toAddr, from, config.twilio.templateSid, opts.contentVariables);
    }
    logger.warn('twilio', '24h window closed — free-form message blocked', { to: toAddr });
    return {
      ok: false,
      windowBlocked: true,
      error:
        `Cannot send a free-form WhatsApp message to ${toAddr}: it is outside the ` +
        `24-hour window since their last message. Set TWILIO_TEMPLATE_SID and pass ` +
        `allowTemplate to use a pre-approved template.`,
    };
  }

  try {
    const msg = await getClient().messages.create({ from, to: toAddr, body });
    logger.info('twilio', 'WhatsApp message sent', { to: toAddr, sid: msg.sid });
    return { ok: true, sid: msg.sid };
  } catch (err) {
    logger.error('twilio', 'WhatsApp send failed', { to: toAddr, error: err.message });
    return { ok: false, error: err.message };
  }
}

async function sendTemplate(toAddr, from, contentSid, contentVariables) {
  try {
    const msg = await getClient().messages.create({
      from,
      to: toAddr,
      contentSid,
      contentVariables: contentVariables ? JSON.stringify(contentVariables) : undefined,
    });
    logger.info('twilio', 'WhatsApp template sent', { to: toAddr, sid: msg.sid });
    return { ok: true, sid: msg.sid, usedTemplate: true };
  } catch (err) {
    logger.error('twilio', 'WhatsApp template send failed', { to: toAddr, error: err.message });
    return { ok: false, error: err.message };
  }
}

// -----------------------------------------------------------------------------
// Place an outbound voice call. Used by "call if no response".
// Plays a spoken message via TwiML (inline, so no extra endpoint needed).
// In SANDBOX mode we DO NOT actually dial — we simulate and log.
// -----------------------------------------------------------------------------
export async function placeCall(to, sayText) {
  try {
    assertConfigured('twilio');
  } catch (err) {
    return { ok: false, error: err.message };
  }

  if (!config.twilio.voiceFrom) {
    return { ok: false, error: 'TWILIO_VOICE_FROM is not set (required for calls).' };
  }

  const toNum = toE164(to);

  if (isSandbox()) {
    logger.info('twilio', '[SANDBOX] Simulated voice call (not dialed)', { to: toNum, sayText });
    return { ok: true, simulated: true, detail: `SANDBOX: would call ${toNum} and say: "${sayText}"` };
  }

  try {
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say({ voice: 'alice' }, sayText);
    const call = await getClient().calls.create({
      from: config.twilio.voiceFrom,
      to: toNum,
      twiml: twiml.toString(),
    });
    logger.info('twilio', 'Voice call placed', { to: toNum, sid: call.sid });
    return { ok: true, sid: call.sid };
  } catch (err) {
    logger.error('twilio', 'Voice call failed', { to: toNum, error: err.message });
    return { ok: false, error: err.message };
  }
}

export async function testConnection() {
  try {
    assertConfigured('twilio');
  } catch (err) {
    return { ok: false, error: err.message };
  }
  try {
    const acct = await getClient().api.v2010.accounts(config.twilio.accountSid).fetch();
    return {
      ok: true,
      detail: `Account "${acct.friendlyName}" status: ${acct.status}. Mode: ${isSandbox() ? 'SANDBOX' : 'LIVE'}.`,
    };
  } catch (err) {
    logger.error('twilio', 'Test connection failed', { error: err.message });
    return { ok: false, error: err.message };
  }
}

// Download media bytes from a Twilio media URL (auth required). Returns a Buffer.
export async function fetchMedia(url) {
  assertConfigured('twilio');
  const auth = Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString('base64');
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) throw new Error(`Failed to fetch media (${res.status})`);
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}
