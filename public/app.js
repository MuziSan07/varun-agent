// Developer console front-end. Vanilla JS, no build step.

const SERVICES = ['claude', 'openai', 'twilio', 'uber'];
let token = localStorage.getItem('dashToken') || '';

function authHeaders(json = true) {
  const h = {};
  if (json) h['Content-Type'] = 'application/json';
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, { ...opts, headers: { ...authHeaders(!!opts.body), ...(opts.headers || {}) } });
  if (res.status === 401) {
    document.getElementById('tokenBar').classList.remove('hidden');
    throw new Error('Unauthorized — enter the dashboard token.');
  }
  return res;
}

// ---- Token bar --------------------------------------------------------------
document.getElementById('tokenSave').onclick = () => {
  token = document.getElementById('tokenInput').value.trim();
  localStorage.setItem('dashToken', token);
  document.getElementById('tokenBar').classList.add('hidden');
  init();
};
if (token) document.getElementById('tokenInput').value = token;

// ---- Mode toggle ------------------------------------------------------------
async function loadStatus() {
  const res = await api('/status');
  const data = await res.json();
  setModeBadge(data.mode);
  renderServices(data.services);
}

function setModeBadge(mode) {
  const el = document.getElementById('modeLabel');
  el.textContent = mode;
  el.className = 'badge ' + (mode === 'LIVE' ? 'live' : 'sandbox');
}

document.getElementById('modeToggle').onclick = async () => {
  const current = document.getElementById('modeLabel').textContent;
  const next = current === 'LIVE' ? 'SANDBOX' : 'LIVE';
  if (next === 'LIVE' && !confirm('Switch to LIVE mode? Real bookings, messages, and calls will happen.')) return;
  const res = await api('/mode', { method: 'POST', body: JSON.stringify({ mode: next }) });
  const data = await res.json();
  setModeBadge(data.mode);
};

// ---- Services ---------------------------------------------------------------
function renderServices(services) {
  const container = document.getElementById('services');
  container.innerHTML = '';
  for (const name of SERVICES) {
    const status = services[name];
    const configured = status ? status.configured : true;
    const missing = status && status.missing ? status.missing : [];
    const subtitle = configured ? 'configured' : `missing: ${missing.join(', ')}`;

    const el = document.createElement('div');
    el.className = 'svc';
    el.innerHTML = `
      <div class="svc-left">
        <div class="svc-name"><span class="dot unknown" id="dot-${name}"></span>${name}</div>
        <div class="svc-status" id="status-${name}">${subtitle}</div>
      </div>
      <button class="btn" data-svc="${name}">Test connection</button>`;
    el.querySelector('button').onclick = () => testService(name);
    container.appendChild(el);
  }
}

async function testService(name) {
  const dot = document.getElementById(`dot-${name}`);
  const status = document.getElementById(`status-${name}`);
  dot.className = 'dot unknown';
  status.textContent = 'testing…';
  try {
    const res = await api(`/test/${name}`, { method: 'POST' });
    const data = await res.json();
    dot.className = 'dot ' + (data.ok ? 'ok' : 'err');
    status.textContent = data.ok ? (data.detail || 'OK') : (data.error || 'failed');
  } catch (err) {
    dot.className = 'dot err';
    status.textContent = err.message;
  }
}

// ---- Agent tester -----------------------------------------------------------
document.getElementById('agentSend').onclick = async () => {
  const text = document.getElementById('agentInput').value.trim();
  const out = document.getElementById('agentReply');
  if (!text) return;
  out.textContent = 'thinking…';
  try {
    const res = await api('/agent/test', { method: 'POST', body: JSON.stringify({ text }) });
    const data = await res.json();
    out.textContent = data.ok ? data.reply : `Error: ${data.error}`;
  } catch (err) { out.textContent = err.message; }
};

// ---- Transcription tester ---------------------------------------------------
document.getElementById('transcribeBtn').onclick = async () => {
  const fileInput = document.getElementById('audioFile');
  const out = document.getElementById('transcribeOut');
  if (!fileInput.files.length) { out.textContent = 'Choose an audio file first.'; return; }
  const file = fileInput.files[0];
  out.textContent = 'transcribing…';
  try {
    const base64 = await fileToBase64(file);
    const res = await api('/transcribe/test', {
      method: 'POST',
      body: JSON.stringify({ base64, filename: file.name, mimetype: file.type }),
    });
    const data = await res.json();
    out.textContent = data.ok ? data.text : `Error: ${data.error}`;
  } catch (err) { out.textContent = err.message; }
};

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---- Send WhatsApp ----------------------------------------------------------
document.getElementById('sendBtn').onclick = async () => {
  const to = document.getElementById('sendTo').value.trim();
  const body = document.getElementById('sendBody').value.trim();
  const out = document.getElementById('sendOut');
  if (!to || !body) { out.textContent = 'Fill in both fields.'; return; }
  out.textContent = 'sending…';
  try {
    const res = await api('/whatsapp/send', { method: 'POST', body: JSON.stringify({ to, body }) });
    const data = await res.json();
    out.textContent = data.ok ? `Sent (sid: ${data.sid || 'n/a'})` : `Error: ${data.error}`;
  } catch (err) { out.textContent = err.message; }
};

// ---- Logs -------------------------------------------------------------------
const logsEl = document.getElementById('logs');
let logLevel = 'all';
document.getElementById('logLevel').onchange = (e) => { logLevel = e.target.value; reloadLogs(); };
document.getElementById('logClear').onclick = () => { logsEl.innerHTML = ''; };

function appendLog(entry) {
  if (logLevel !== 'all' && entry.level !== logLevel) return;
  const div = document.createElement('div');
  div.className = `log ${entry.level}`;
  const meta = entry.meta ? ' ' + JSON.stringify(entry.meta) : '';
  div.innerHTML =
    `<span class="ts">${entry.ts.split('T')[1]?.replace('Z', '') || entry.ts}</span> ` +
    `<span class="lvl">${entry.level.toUpperCase()}</span> ` +
    `<span class="scope">(${entry.scope})</span> ` +
    `${escapeHtml(entry.message)}${escapeHtml(meta)}`;
  logsEl.appendChild(div);
  logsEl.scrollTop = logsEl.scrollHeight;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

async function reloadLogs() {
  logsEl.innerHTML = '';
  try {
    const res = await api(`/logs?level=${logLevel}`);
    const data = await res.json();
    data.logs.forEach(appendLog);
  } catch (err) { /* token bar already shown */ }
}

function streamLogs() {
  const url = token ? `/api/logs/stream?token=${encodeURIComponent(token)}` : '/api/logs/stream';
  const es = new EventSource(url);
  es.onmessage = (e) => { try { appendLog(JSON.parse(e.data)); } catch {} };
  es.onerror = () => { es.close(); setTimeout(streamLogs, 3000); };
}

// ---- Init -------------------------------------------------------------------
async function init() {
  try {
    await loadStatus();
    await reloadLogs();
    streamLogs();
  } catch (err) {
    // Unauthorized -> token bar is shown by api()
  }
}
init();
