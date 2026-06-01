// -----------------------------------------------------------------------------
// Tool definitions + handlers for the Claude tool-calling agent.
//
// Each tool has:
//   - a schema (name/description/input_schema) sent to Claude, and
//   - a handler(input, ctx) that actually performs the action.
//
// ctx = { from } where `from` is the owner's WhatsApp number (the caller).
//
// Costly/irreversible actions (ride/flight booking, placing calls) are guarded:
// in SANDBOX they never hit live endpoints; the agent is also told to confirm
// before booking unless the user was explicit.
// -----------------------------------------------------------------------------
import { isSandbox } from '../config.js';
import { logger } from '../logger.js';
import {
  listContacts, findContact, upsertContact, addReminder, addJob,
} from '../store/store.js';
import { sendWhatsApp, placeCall } from '../services/twilio.js';
import { requestRide } from '../services/uber.js';
import { geocode } from '../utils/geocode.js';
import { toE164, isValidE164 } from '../utils/phone.js';

// Resolve a contact reference (name OR phone) to an E.164 number + label.
function resolveTarget(ref) {
  if (!ref) return { error: 'No contact specified.' };
  if (isValidE164(ref)) return { phone: toE164(ref), label: ref };
  const contact = findContact(ref);
  if (contact) return { phone: contact.phone, label: contact.name };
  return { error: `No saved contact matches "${ref}", and it is not a valid phone number. ` +
    `Add them first with add_contact, or provide an E.164 number like +12223334444.` };
}

export const TOOLS = [
  // -------------------------------------------------------------- book_ride
  {
    schema: {
      name: 'book_ride',
      description:
        'Book an Uber ride from a pickup location to a destination. Provide human-readable ' +
        'place names; they will be geocoded. Confirm with the user before booking unless they ' +
        'were explicit about wanting it booked now.',
      input_schema: {
        type: 'object',
        properties: {
          pickup: { type: 'string', description: 'Pickup place name or address (e.g. "home", "Bandra, Mumbai").' },
          destination: { type: 'string', description: 'Destination place name or address.' },
        },
        required: ['pickup', 'destination'],
      },
    },
    async handler({ pickup, destination }) {
      const a = await geocode(pickup);
      if (!a.ok) return { ok: false, error: `Pickup: ${a.error}` };
      const b = await geocode(destination);
      if (!b.ok) return { ok: false, error: `Destination: ${b.error}` };
      const res = await requestRide({
        startLat: a.lat, startLng: a.lng, endLat: b.lat, endLng: b.lng,
        pickupName: a.label, destName: b.label,
      });
      return res;
    },
  },

  // ------------------------------------------------------------ send_message
  {
    schema: {
      name: 'send_message',
      description:
        "Send a WhatsApp message to one of the client's contacts (by saved name) or to a phone " +
        'number in E.164 format. Used for outreach like "ask Ramesh for updates". Respects the ' +
        'WhatsApp 24-hour window automatically.',
      input_schema: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Contact name (e.g. "Ramesh") or E.164 number.' },
          message: { type: 'string', description: 'The message body to send.' },
        },
        required: ['to', 'message'],
      },
    },
    async handler({ to, message }) {
      const t = resolveTarget(to);
      if (t.error) return { ok: false, error: t.error };
      const res = await sendWhatsApp(t.phone, message, { allowTemplate: true });
      if (res.windowBlocked) {
        return {
          ok: false,
          error: `${t.label} hasn't messaged the bot in the last 24h, so WhatsApp blocks a ` +
            `free-form message. To reach them now you need a pre-approved template (set ` +
            `TWILIO_TEMPLATE_SID). Tell the user this limitation.`,
        };
      }
      return res.ok
        ? { ok: true, detail: `Message sent to ${t.label}.` }
        : { ok: false, error: res.error };
    },
  },

  // ------------------------------------------------------------- add_contact
  {
    schema: {
      name: 'add_contact',
      description: "Save or update a contact in the client's address book.",
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Contact name.' },
          phone: { type: 'string', description: 'Phone number in E.164 (e.g. +919812345678).' },
        },
        required: ['name', 'phone'],
      },
    },
    async handler({ name, phone }) {
      if (!isValidE164(phone)) {
        return { ok: false, error: `"${phone}" is not a valid E.164 number (e.g. +919812345678).` };
      }
      const c = upsertContact({ name, phone: toE164(phone) });
      return { ok: true, detail: `Saved ${c.name} (${c.phone}).` };
    },
  },

  // ----------------------------------------------------------- list_contacts
  {
    schema: {
      name: 'list_contacts',
      description: "List the client's saved contacts.",
      input_schema: { type: 'object', properties: {} },
    },
    async handler() {
      const contacts = listContacts();
      return { ok: true, contacts: contacts.map((c) => ({ name: c.name, phone: c.phone })) };
    },
  },

  // ------------------------------------------------------------ set_reminder
  {
    schema: {
      name: 'set_reminder',
      description:
        'Schedule a one-off reminder to be sent at a specific time. The reminder can go to the ' +
        'client themselves ("remind me ...") or to a contact ("remind Ramesh ..."). You MUST ' +
        'convert the user\'s natural-language time into an absolute ISO 8601 timestamp using the ' +
        'current date/time given in the system prompt.',
      input_schema: {
        type: 'object',
        properties: {
          to: { type: 'string', description: '"me" for the client, or a contact name / E.164 number.' },
          message: { type: 'string', description: 'What to remind them about.' },
          dueAt: { type: 'string', description: 'Absolute ISO 8601 timestamp, e.g. 2026-05-30T17:30:00+05:30.' },
        },
        required: ['to', 'message', 'dueAt'],
      },
    },
    async handler({ to, message, dueAt }, ctx) {
      const when = new Date(dueAt);
      if (isNaN(when.getTime())) return { ok: false, error: `"${dueAt}" is not a valid timestamp.` };

      let phone, label;
      if (!to || /^(me|myself|i)$/i.test(to.trim())) {
        phone = toE164(ctx.from); label = 'you';
      } else {
        const t = resolveTarget(to);
        if (t.error) return { ok: false, error: t.error };
        phone = t.phone; label = t.label;
      }

      const rem = addReminder({ to: phone, message, dueAt: when.toISOString() });
      return { ok: true, detail: `Reminder set for ${label} at ${when.toISOString()}.`, id: rem.id };
    },
  },

  // ------------------------------------------------------------ call_contact
  {
    schema: {
      name: 'call_contact',
      description:
        'Place an immediate phone CALL to a contact and speak a short message. Use only when ' +
        'asked to call directly. In SANDBOX mode the call is simulated, not dialed.',
      input_schema: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Contact name or E.164 number.' },
          message: { type: 'string', description: 'What to say on the call (kept short).' },
        },
        required: ['to', 'message'],
      },
    },
    async handler({ to, message }) {
      const t = resolveTarget(to);
      if (t.error) return { ok: false, error: t.error };
      const res = await placeCall(t.phone, message);
      return res.ok
        ? { ok: true, detail: res.detail || `Calling ${t.label}.` }
        : { ok: false, error: res.error };
    },
  },

  // ------------------------------------------ message_then_call_if_no_response
  {
    schema: {
      name: 'message_then_call_if_no_response',
      description:
        'Send a WhatsApp message to a contact now, then automatically PHONE them if they have ' +
        'not replied after a wait period. This schedules a durable background job that survives ' +
        'restarts. Use for "message X and call them if they don\'t respond".',
      input_schema: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Contact name or E.164 number.' },
          message: { type: 'string', description: 'The WhatsApp message to send now.' },
          waitMinutes: { type: 'integer', description: 'How long to wait for a reply before calling (default 30).' },
          callMessage: { type: 'string', description: 'What to say on the call if they did not reply.' },
        },
        required: ['to', 'message'],
      },
    },
    async handler({ to, message, waitMinutes = 30, callMessage }, ctx) {
      const t = resolveTarget(to);
      if (t.error) return { ok: false, error: t.error };

      const sent = await sendWhatsApp(t.phone, message, { allowTemplate: true });
      if (!sent.ok && !sent.windowBlocked) return { ok: false, error: sent.error };

      const runAt = new Date(Date.now() + waitMinutes * 60 * 1000).toISOString();
      const job = addJob({
        type: 'call_if_no_response',
        runAt,
        payload: {
          contactPhone: t.phone,
          contactLabel: t.label,
          ownerPhone: toE164(ctx.from),
          sentAt: new Date().toISOString(),
          callMessage: callMessage || `Hello, this is an automated call on behalf of the client. ` +
            `They messaged you and would appreciate a reply. Thank you.`,
        },
      });

      const note = sent.windowBlocked
        ? ` (Note: the initial WhatsApp message could not be sent because it is outside ${t.label}'s 24h window; ` +
          `the scheduled call will still happen.)`
        : '';
      return {
        ok: true,
        detail: `Messaged ${t.label}. If no reply within ${waitMinutes} min, I'll call them automatically.${note}`,
        jobId: job.id,
      };
    },
  },
];

// Map name -> handler for the agent loop.
export const TOOL_HANDLERS = Object.fromEntries(TOOLS.map((t) => [t.schema.name, t.handler]));
export const TOOL_SCHEMAS = TOOLS.map((t) => t.schema);

// Execute a tool by name with structured error capture.
export async function runTool(name, input, ctx) {
  const handler = TOOL_HANDLERS[name];
  if (!handler) return { ok: false, error: `Unknown tool: ${name}` };
  try {
    logger.info('agent', `tool:${name}`, { input, sandbox: isSandbox() });
    const result = await handler(input, ctx);
    return result;
  } catch (err) {
    logger.error('agent', `tool:${name} threw`, { error: err.message });
    return { ok: false, error: err.message };
  }
}
