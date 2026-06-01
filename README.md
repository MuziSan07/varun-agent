# WhatsApp AI Assistant

A personal WhatsApp AI assistant for a single client. Message it on WhatsApp (text
**or voice notes**, in English / Hindi / Hinglish) and it takes real actions:
books **Uber** rides, **messages your contacts**, sends **reminders**, and
**phones a contact if they don't reply**.

The brain is **Claude** (tool-calling). Voice notes are transcribed with **OpenAI
Whisper**. Messaging + calls go through **Twilio**. There's a built-in **developer
dashboard** to test every API, watch live logs, and flip between **SANDBOX** and
**LIVE**.

---

## 1. Tech stack & why

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node.js 22 (ESM, plain JS) | First-class fit for Twilio webhooks + async API calls; **no build step**, so it runs as-is locally and in a container. |
| Web | Express | Tiny, ubiquitous; serves the webhook + dashboard from one process. |
| Agent | Claude tool-calling (`@anthropic-ai/sdk`) | The LLM picks the action (`book_ride`, `send_message`, …) from natural language. |
| Voice | OpenAI Whisper (`whisper-1`) | Strong multilingual + code-switching transcription (see Hinglish note). |
| Messaging/Voice | Twilio | WhatsApp + outbound calls in one vendor; has a sandbox. |
| Persistence | JSON file store behind a repo interface | **Zero native deps** (runs anywhere incl. Windows) and **survives restarts**. Swap for Postgres in production by reimplementing `src/store/store.js`. |
| Dashboard | Vanilla HTML/CSS/JS | No frontend build; loads instantly. |

### Folder structure
```
src/
  index.js            # entrypoint: starts server + scheduler (never crashes on empty keys)
  config.js           # env loading, per-service "is configured?" checks, SANDBOX/LIVE toggle
  logger.js           # centralized logging + in-memory ring buffer + SSE for the dashboard
  server.js           # Express: dashboard API + WhatsApp webhook
  store/store.js      # persistent JSON datastore (contacts, reminders, jobs, conversations)
  services/
    claude.js         # agent brain + testConnection
    openai.js         # Whisper transcription + testConnection
    twilio.js         # WhatsApp send (24h-aware) + voice calls + testConnection
    uber.js           # ride booking (sandbox/live) + testConnection
  agent/
    agent.js          # the tool-calling loop
    tools.js          # tool schemas + handlers
  whatsapp/webhook.js # inbound text + voice-note handling
  scheduler/scheduler.js # durable reminders + "call-if-no-response" jobs
  utils/              # phone/E.164 + 24h-window + geocoding
public/               # developer dashboard (index.html, app.js, styles.css)
tests/                # unit tests (node:test)
Dockerfile, docker-compose.yml
```

---

## 2. Setup

### Prerequisites
- Node.js **20+** (22 recommended).
- Accounts/keys for the services you want to use (you can start with just Claude).

### Install
```bash
npm install
```

### Configure
```bash
cp .env.example .env      # Windows: copy .env.example .env
```
Open `.env` and fill in what you have. **It's fine to leave keys blank** — the app
boots anyway and the dashboard tells you exactly which variable is missing per
service. Key variables:

- `ANTHROPIC_API_KEY` — Claude (agent brain).
- `OPENAI_API_KEY` — Whisper (voice notes).
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` — Twilio.
- `TWILIO_VOICE_FROM` — a Twilio voice number for calls.
- `TWILIO_TEMPLATE_SID` — *optional* approved template for messaging contacts
  outside the 24h window (see constraints below).
- `UBER_ACCESS_TOKEN` — Uber.
- `OWNER_WHATSAPP_NUMBER` — your WhatsApp number in E.164 (so the agent knows who
  "me" is for self-reminders).
- `PUBLIC_BASE_URL` — your public tunnel URL (for Twilio callbacks / signature
  validation), e.g. an ngrok URL during local testing.
- `DASHBOARD_TOKEN` — set any random string to protect the dashboard. **Required
  before deploying** (left blank = open dashboard, warned at boot).

### Run
```bash
npm start         # production-style
npm run dev       # auto-reload on change
```
Open the dashboard at **http://localhost:3000/**.

### Run tests
```bash
npm test
```

---

## 3. Connecting WhatsApp (Twilio)

1. In the Twilio console open the **WhatsApp Sandbox** and join it from your phone
   (send the `join <code>` message).
2. Expose your local server publicly (Twilio needs to reach the webhook):
   ```bash
   npx ngrok http 3000
   ```
   Put the https URL in `PUBLIC_BASE_URL` in `.env`.
3. In the Twilio WhatsApp Sandbox settings, set **"When a message comes in"** to:
   ```
   https://<your-ngrok>.ngrok-free.app/webhook/whatsapp   (POST)
   ```
4. Message your sandbox number — you're talking to the agent.

Switch to LIVE only with an approved WhatsApp Business sender in
`TWILIO_WHATSAPP_LIVE_FROM` and the dashboard toggle set to LIVE.

---

## 4. Key design decisions & constraints

### SANDBOX vs LIVE (default SANDBOX)
A first-class toggle (env `MODE` + dashboard button, persisted across restarts). In
SANDBOX: Uber hits the sandbox host, **voice calls are simulated (not dialed)**, and
the agent's system prompt makes the mode explicit. Flip to LIVE only when ready.

### WhatsApp 24-hour window
WhatsApp only allows free-form messages to a user within **24h of their last inbound
message**. We track `lastInboundAt` per number in the datastore and:
- **Replies** to an inbound message are sent via TwiML in-session (always allowed).
- **Proactive** sends (reminders, "message Ramesh", call-if-no-response) check the
  window. Outside it, we either send a **pre-approved template**
  (`TWILIO_TEMPLATE_SID`) or, if none is set, **surface the limitation clearly** to
  the client and to the logs — never a silent failure.
- **Compliance:** your contacts didn't opt into a bot. Outreach should be expected
  by the recipient; templates must be approved; consider local consent rules before
  enabling LIVE proactive messaging.

### Hinglish transcription (the hard case)
Approach in `src/services/openai.js`, justified:
1. **Don't force a language.** Forcing `hi` corrupts the embedded English of
   Hinglish (and forcing `en` corrupts Hindi). We let Whisper auto-detect.
2. **Prime with a `prompt`** telling Whisper the speaker code-switches between
   Hindi and English and may use Roman or Devanagari script, with Indian names —
   this measurably improves code-switched output.
3. **Separation of concerns:** transcription is independent and testable (dashboard
   "Transcription" card + you can wire your own clips). Claude then *interprets* the
   transcript, and LLMs handle imperfect Hinglish text robustly.

### "Call if no response" (durable)
`message_then_call_if_no_response` sends the message now and writes a
`call_if_no_response` **job** (with `runAt`) to the datastore. The **scheduler**
polls every 15s; when due it checks whether the contact replied since the message
was sent — if not, it places the call (simulated in SANDBOX) and notifies the
owner. Because the job lives in the store, **it survives restarts**.

### Flights — not included
Flight booking is intentionally **not** implemented: Uber has no flight product in
India and no other flight vendor is being integrated for now. If this changes later,
add a `book_flight` tool in `src/agent/tools.js` plus a `src/services/flight/` module
behind a small interface — the tool-calling architecture absorbs it without touching
anything else. Until then the agent tells the user flights aren't supported.

### Graceful with empty keys
`config.js` never throws at import. Each service exposes `testConnection()` and a
`serviceStatus()` that names the exact missing variable. The dashboard surfaces all
of this; the process logs a per-service ✓/✗ summary at boot.

---

## 5. What to test first

1. **It boots clean with empty `.env`** — `npm start` should print a ✓/✗ summary
   and NOT crash. Open http://localhost:3000/.
2. **Connection tests** — add `ANTHROPIC_API_KEY`, restart, click **Test
   connection** on *Claude* → should pass. Repeat per service; failures show the
   real error.
3. **Agent dry-run (no WhatsApp)** — in the dashboard "Try the agent" box:
   `"Add a contact: Ramesh +9198XXXXXXXX"`, then
   `"Message Ramesh: any update on the Mumbai site?"`. Watch the logs.
4. **Ride booking (SANDBOX)** — `"Book me an Uber from Bandra to Mumbai airport"`
   (needs `UBER_ACCESS_TOKEN`).
5. **Reminder** — `"Remind me in 2 minutes to call the bank"`; confirm it arrives
   (needs Twilio + your number joined to the sandbox).
6. **Transcription** — upload an English, then a Hindi, then a Hinglish clip in the
   "Transcription" card.
7. **Call-if-no-response** — `"Message Ramesh 'ping' and call him if he doesn't
   reply in 1 minute"`; in SANDBOX the call is simulated and logged.
8. **End-to-end on WhatsApp** — set up the Twilio sandbox + ngrok (section 3) and
   message the bot for real.

---

## 6. Deploying

- Containerized: `docker compose up --build` (mounts a volume at `/app/data` so
  reminders/jobs persist).
- Set all real values via environment variables (no machine-specific paths).
- **Set `DASHBOARD_TOKEN`** and serve over HTTPS before exposing the dashboard.
- For real scale/durability, repoint `src/store/store.js` at Postgres/Redis — the
  rest of the app is storage-agnostic.

## Security notes
- Secrets only in `.env` (git-ignored). Logs auto-redact token/secret/key fields.
- Twilio webhook signature validation is enabled when `PUBLIC_BASE_URL` +
  `TWILIO_AUTH_TOKEN` are set.
- Booking/call actions are confirmed by the agent and gated by SANDBOX by default.
