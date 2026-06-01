// -----------------------------------------------------------------------------
// Twilio WhatsApp inbound webhook.
//
// Handles both text and VOICE NOTES:
//   - text: passed straight to the agent.
//   - voice: media is downloaded from Twilio, transcribed via Whisper (English/
//     Hindi/Hinglish), then passed to the agent.
//
// IMPORTANT — async ack pattern:
// The agent loop (several Claude calls + tool calls like geocoding/Uber) can take
// longer than Twilio's webhook timeout (~10-15s). If we block until the agent is
// done, Twilio times out and RETRIES the webhook, causing duplicate processing
// and lost replies. So we ACK Twilio immediately with empty TwiML, then do the
// work and send the reply out-of-band via the REST API (sendWhatsApp). The reply
// is always inside the 24h window (it answers the message just received), so we
// pass { force: true }.
// -----------------------------------------------------------------------------
import twilio from 'twilio';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { recordMessage } from '../store/store.js';
import { runAgent } from '../agent/agent.js';
import { fetchMedia, sendWhatsApp } from '../services/twilio.js';
import { transcribe } from '../services/openai.js';
import { toFile } from 'openai';

const { MessagingResponse } = twilio.twiml;

export async function handleInboundWhatsApp(req, res) {
  const from = req.body.From; // e.g. "whatsapp:+1222..."
  const numMedia = parseInt(req.body.NumMedia || '0', 10);

  // 1) Acknowledge Twilio IMMEDIATELY (empty TwiML) so the webhook never times out.
  const empty = new MessagingResponse();
  res.type('text/xml').send(empty.toString());

  // 2) Process + reply out-of-band. Errors are logged, never thrown to Twilio.
  processInbound(req.body, from, numMedia).catch((err) => {
    logger.error('whatsapp', 'Async inbound processing failed', { from, error: err.message });
  });
}

async function processInbound(body, from, numMedia) {
  let userText = (body.Body || '').trim();

  // ---- Voice note? transcribe it -------------------------------------------
  if (numMedia > 0) {
    const mediaType = body.MediaContentType0 || '';
    if (mediaType.startsWith('audio')) {
      try {
        const buf = await fetchMedia(body.MediaUrl0);
        const ext = mediaType.includes('ogg') ? 'ogg' : mediaType.includes('mpeg') ? 'mp3' : 'wav';
        const file = await toFile(buf, `voice.${ext}`, { type: mediaType });
        userText = await transcribe(file);
        logger.info('whatsapp', 'Voice note transcribed', { from, chars: userText.length });
      } catch (err) {
        logger.error('whatsapp', 'Transcription failed', { error: err.message });
        await send(from, "I couldn't understand that voice note (transcription failed). Could you type it or resend?");
        return;
      }
    } else {
      await send(from, "I can read text and listen to voice notes, but I can't open that attachment yet.");
      return;
    }
  }

  if (!userText) {
    await send(from, 'Send me a message or a voice note and I’ll help.');
    return;
  }

  // Record inbound (also updates the 24h-window timestamp for this number).
  recordMessage(from, 'user', userText);

  // ---- Run the agent -------------------------------------------------------
  const reply = await runAgent({ from, text: userText });
  recordMessage(from, 'assistant', reply);
  await send(from, reply);
}

// Send a reply via REST. force:true because this answers a just-received message.
async function send(to, text) {
  const result = await sendWhatsApp(to, text, { force: true });
  if (!result.ok) logger.error('whatsapp', 'Failed to send reply', { to, error: result.error });
  return result;
}

// Optional signature validation. OPT-IN via TWILIO_VALIDATE_SIGNATURE=true so that
// sandbox testing through a tunnel never fails on a URL/proto mismatch. Strongly
// recommended ON in production (with a stable PUBLIC_BASE_URL).
export function validateTwilioSignature(req, res, next) {
  if (!config.enforceTwilioSignature) return next();
  if (!config.twilio.authToken || !config.publicBaseUrl) return next();
  const signature = req.headers['x-twilio-signature'];
  const url = `${config.publicBaseUrl}${req.originalUrl}`;
  const valid = twilio.validateRequest(config.twilio.authToken, signature, url, req.body);
  if (!valid) {
    logger.warn('whatsapp', 'Invalid Twilio signature — rejected', { url });
    return res.status(403).send('Invalid signature');
  }
  return next();
}
