// -----------------------------------------------------------------------------
// Persistent datastore.
//
// A dependency-free JSON-file store behind a small repository interface. It is
// deliberately simple so the project runs anywhere (incl. Windows) with zero
// native compilation, while still SURVIVING RESTARTS — which the scheduler and
// "call-if-no-response" feature require.
//
// Collections:
//   - contacts        : the client's address book (name -> phone)
//   - reminders       : scheduled reminders (one-shot)
//   - jobs            : generic scheduled jobs incl. "wait-and-check" calls
//   - conversations   : recent message history per WhatsApp number (for context
//                       and for the 24h-window check via lastInboundAt)
//   - settings        : runtime settings (e.g. persisted MODE)
//
// PRODUCTION NOTE: in the cloud, point this at Postgres/Redis by reimplementing
// the same exported functions — nothing else in the codebase touches the files.
// -----------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT_DB = {
  contacts: [],
  reminders: [],
  jobs: [],
  conversations: {}, // keyed by whatsapp number
  settings: {},
};

let db = null;
let writeQueued = false;

function ensureLoaded() {
  if (db) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DB_FILE)) {
      db = { ...DEFAULT_DB, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
    } else {
      db = structuredClone(DEFAULT_DB);
      flushSync();
    }
  } catch (err) {
    // Corrupt or unreadable file: start fresh rather than crash, but keep a
    // backup so nothing is silently lost.
    if (fs.existsSync(DB_FILE)) {
      try { fs.renameSync(DB_FILE, `${DB_FILE}.corrupt-${Date.now()}`); } catch { /* ignore */ }
    }
    db = structuredClone(DEFAULT_DB);
    flushSync();
  }
}

// Atomic-ish write: write to a temp file then rename.
function flushSync() {
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// Debounced async flush for hot paths.
function flush() {
  if (writeQueued) return;
  writeQueued = true;
  setTimeout(() => {
    writeQueued = false;
    try { flushSync(); } catch { /* logged by caller paths if needed */ }
  }, 50);
}

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---- Settings ---------------------------------------------------------------
export function getSetting(key, fallback = null) {
  ensureLoaded();
  return key in db.settings ? db.settings[key] : fallback;
}
export function setSetting(key, value) {
  ensureLoaded();
  db.settings[key] = value;
  flush();
}

// ---- Contacts ---------------------------------------------------------------
export function listContacts() {
  ensureLoaded();
  return [...db.contacts];
}

export function findContact(name) {
  ensureLoaded();
  if (!name) return null;
  const needle = name.trim().toLowerCase();
  // exact, then startsWith, then includes
  return (
    db.contacts.find((c) => c.name.toLowerCase() === needle) ||
    db.contacts.find((c) => c.name.toLowerCase().startsWith(needle)) ||
    db.contacts.find((c) => c.name.toLowerCase().includes(needle)) ||
    null
  );
}

export function upsertContact({ name, phone }) {
  ensureLoaded();
  const existing = db.contacts.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
  if (existing) {
    existing.phone = phone;
    flush();
    return existing;
  }
  const contact = { id: id('contact'), name: name.trim(), phone, createdAt: new Date().toISOString() };
  db.contacts.push(contact);
  flush();
  return contact;
}

export function removeContact(name) {
  ensureLoaded();
  const before = db.contacts.length;
  db.contacts = db.contacts.filter((c) => c.name.toLowerCase() !== name.trim().toLowerCase());
  flush();
  return before !== db.contacts.length;
}

// ---- Reminders --------------------------------------------------------------
export function addReminder({ to, message, dueAt }) {
  ensureLoaded();
  const reminder = {
    id: id('rem'),
    to,             // E.164 phone (owner or contact)
    message,
    dueAt,          // ISO string
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  db.reminders.push(reminder);
  flush();
  return reminder;
}

export function listReminders(status) {
  ensureLoaded();
  return db.reminders.filter((r) => !status || r.status === status);
}

export function updateReminder(reminderId, patch) {
  ensureLoaded();
  const r = db.reminders.find((x) => x.id === reminderId);
  if (r) { Object.assign(r, patch); flush(); }
  return r;
}

// ---- Jobs (generic scheduled work, incl. wait-and-check calls) --------------
export function addJob(job) {
  ensureLoaded();
  const record = {
    id: id('job'),
    status: 'pending',
    createdAt: new Date().toISOString(),
    ...job, // expects: type, runAt (ISO), payload
  };
  db.jobs.push(record);
  flush();
  return record;
}

export function listJobs(status) {
  ensureLoaded();
  return db.jobs.filter((j) => !status || j.status === status);
}

export function updateJob(jobId, patch) {
  ensureLoaded();
  const j = db.jobs.find((x) => x.id === jobId);
  if (j) { Object.assign(j, patch); flush(); }
  return j;
}

// ---- Conversations (context + 24h window tracking) --------------------------
export function recordMessage(number, role, text) {
  ensureLoaded();
  const key = normalizeKey(number);
  if (!db.conversations[key]) {
    db.conversations[key] = { history: [], lastInboundAt: null, lastOutboundAt: null };
  }
  const conv = db.conversations[key];
  const now = new Date().toISOString();
  conv.history.push({ role, text, ts: now });
  // keep last 30 turns for context
  if (conv.history.length > 30) conv.history = conv.history.slice(-30);
  if (role === 'user') conv.lastInboundAt = now;
  if (role === 'assistant') conv.lastOutboundAt = now;
  flush();
  return conv;
}

export function getConversation(number) {
  ensureLoaded();
  return db.conversations[normalizeKey(number)] || { history: [], lastInboundAt: null, lastOutboundAt: null };
}

// When did this number last message US? Used for the WhatsApp 24h-window rule.
export function lastInboundAt(number) {
  return getConversation(number).lastInboundAt;
}

function normalizeKey(number) {
  return String(number).replace(/^whatsapp:/i, '').trim();
}

// Exposed for tests / maintenance.
export function _reset() {
  db = structuredClone(DEFAULT_DB);
  flushSync();
}
