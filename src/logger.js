// -----------------------------------------------------------------------------
// Centralized logging.
//
// Every log line goes to (1) the console (stdout/stderr — picked up by cloud log
// drains) and (2) an in-memory ring buffer the developer dashboard reads so the
// developer can watch live errors in the browser. No silent failures.
// -----------------------------------------------------------------------------

const MAX_LOGS = 500;
const buffer = []; // newest last
const subscribers = new Set(); // for SSE streaming to the dashboard

function push(level, scope, message, meta) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    scope: scope || 'app',
    message: typeof message === 'string' ? message : safeStringify(message),
    meta: meta ? safeMeta(meta) : undefined,
  };

  buffer.push(entry);
  if (buffer.length > MAX_LOGS) buffer.shift();

  const line = `[${entry.ts}] ${level.toUpperCase()} (${entry.scope}) ${entry.message}` +
    (entry.meta ? ` ${JSON.stringify(entry.meta)}` : '');
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);

  for (const fn of subscribers) {
    try { fn(entry); } catch { /* never let a subscriber break logging */ }
  }
  return entry;
}

function safeStringify(v) {
  try { return JSON.stringify(v); } catch { return String(v); }
}

// Strip anything that looks like a secret before it can reach the browser/logs.
function safeMeta(meta) {
  const clone = {};
  for (const [k, v] of Object.entries(meta)) {
    if (/token|secret|key|auth|password/i.test(k)) clone[k] = '***redacted***';
    else clone[k] = v;
  }
  return clone;
}

export const logger = {
  debug: (scope, msg, meta) => push('debug', scope, msg, meta),
  info: (scope, msg, meta) => push('info', scope, msg, meta),
  warn: (scope, msg, meta) => push('warn', scope, msg, meta),
  error: (scope, msg, meta) => push('error', scope, msg, meta),

  // Snapshot for the dashboard log view (optionally filtered by level).
  getLogs(level) {
    if (!level || level === 'all') return [...buffer];
    return buffer.filter((e) => e.level === level);
  },

  // Live stream for Server-Sent Events.
  subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  },
};
