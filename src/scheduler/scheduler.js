// -----------------------------------------------------------------------------
// Durable scheduler.
//
// A simple poll loop (every POLL_MS) reads DUE work from the persistent store and
// executes it. Because state lives in the datastore (not in memory), reminders
// and "call-if-no-response" jobs SURVIVE RESTARTS — required by CLAUDE.md.
//
// Handles:
//   - reminders          : send the reminder message when dueAt passes.
//   - call_if_no_response : after the wait, check whether the contact replied
//                           since the message was sent; if not, place a call.
// -----------------------------------------------------------------------------
import { logger } from '../logger.js';
import {
  listReminders, updateReminder, listJobs, updateJob, lastInboundAt,
} from '../store/store.js';
import { sendWhatsApp, placeCall } from '../services/twilio.js';

const POLL_MS = 15 * 1000;
let timer = null;

export function startScheduler() {
  if (timer) return;
  logger.info('scheduler', `Started (polling every ${POLL_MS / 1000}s).`);
  timer = setInterval(tick, POLL_MS);
  // run once shortly after boot to catch anything already due
  setTimeout(tick, 2000);
}

export function stopScheduler() {
  if (timer) { clearInterval(timer); timer = null; }
}

async function tick() {
  try {
    await processReminders();
    await processJobs();
  } catch (err) {
    logger.error('scheduler', 'tick failed', { error: err.message });
  }
}

async function processReminders() {
  const now = Date.now();
  for (const r of listReminders('pending')) {
    if (new Date(r.dueAt).getTime() > now) continue;
    updateReminder(r.id, { status: 'sending' });
    const body = `⏰ Reminder: ${r.message}`;
    // Reminders to a contact may fall outside their 24h window -> allow template.
    const res = await sendWhatsApp(r.to, body, { allowTemplate: true });
    if (res.ok) {
      updateReminder(r.id, { status: 'sent', sentAt: new Date().toISOString() });
      logger.info('scheduler', 'Reminder sent', { to: r.to, id: r.id });
    } else {
      updateReminder(r.id, { status: 'failed', error: res.error });
      logger.warn('scheduler', 'Reminder failed', { to: r.to, id: r.id, error: res.error });
    }
  }
}

async function processJobs() {
  const now = Date.now();
  for (const job of listJobs('pending')) {
    if (new Date(job.runAt).getTime() > now) continue;

    if (job.type === 'call_if_no_response') {
      updateJob(job.id, { status: 'running' });
      const { contactPhone, contactLabel, ownerPhone, sentAt, callMessage } = job.payload;

      // Did the contact reply since we messaged them?
      const replyAt = lastInboundAt(contactPhone);
      const replied = replyAt && new Date(replyAt).getTime() > new Date(sentAt).getTime();

      if (replied) {
        updateJob(job.id, { status: 'done', outcome: 'contact_replied' });
        logger.info('scheduler', 'Contact replied — no call needed', { contact: contactPhone });
        if (ownerPhone) {
          await sendWhatsApp(ownerPhone, `✅ ${contactLabel} replied — no call needed.`, { force: true });
        }
        continue;
      }

      const call = await placeCall(contactPhone, callMessage);
      updateJob(job.id, {
        status: 'done',
        outcome: call.ok ? 'called' : 'call_failed',
        error: call.ok ? undefined : call.error,
      });
      logger.info('scheduler', 'No reply — call attempted', { contact: contactPhone, ok: call.ok });

      if (ownerPhone) {
        const note = call.ok
          ? `📞 ${contactLabel} didn't reply, so I ${call.simulated ? '(SANDBOX) would have called' : 'called'} them.`
          : `⚠️ ${contactLabel} didn't reply and the call failed: ${call.error}`;
        await sendWhatsApp(ownerPhone, note, { force: true });
      }
    } else {
      updateJob(job.id, { status: 'skipped', error: `Unknown job type ${job.type}` });
      logger.warn('scheduler', 'Unknown job type', { id: job.id, type: job.type });
    }
  }
}
