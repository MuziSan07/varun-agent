# CLAUDE.md — WhatsApp AI Assistant Agent

## Project overview
A personal WhatsApp AI assistant for a single client. The client talks to it over
WhatsApp like texting a friend (text or voice notes), and it carries out actions:
booking rides, booking flights, messaging the client's contacts, sending reminders,
and placing calls. The system must be **fully automated** and **cloud-deployable**
(developed and tested locally first).

## Core capabilities
1. **Ride booking** via the Uber API (client's location → chosen destination).
2. **Flight booking** — **deferred / not implemented** (decision 2026-05-30). Uber
   has no flight product in India and no other flight vendor is being integrated for
   now. The agent tells the user flights aren't supported. Re-add later via a
   `book_flight` tool + `src/services/flight/` module behind an interface.
3. **Voice note understanding** in **English, Hindi, and Hinglish** (transcribe → interpret).
4. **Outbound messaging** to the client's contacts on the client's instruction.
5. **Reminders** to both the client and contacts.
6. **Phone calls** to a contact when they don't respond to messages.

## Available services
Credentials live ONLY in `.env`. Never hardcode secrets.
- **Claude API** (Anthropic) — primary reasoning / agent brain.
- **OpenAI API** — available (e.g. Whisper for transcription if chosen).
- **Twilio** — WhatsApp messaging + outbound voice calls.
- **Uber API** — ride booking.

## Build approach (IMPORTANT)
- Generate the **complete codebase up front**. Leave `.env` values **empty** — the
  developer fills real keys in afterward.
- The app **must not crash on startup with empty keys**. Fail gracefully with a clear
  message naming exactly which variable is missing.
- Provide a `.env.example` listing every required variable (names only, no values).
- Provide a `README` explaining how to fill `.env` and run locally.

## Developer UI (required deliverable)
A single web dashboard for the developer (not the end client) that provides:
- **API connection tests**: a "Test connection" button per service (Claude, OpenAI,
  Twilio, Uber) showing pass/fail plus the real error message on failure.
- **Live error logs**: viewable in the browser.
- **Sandbox toggle**: switch between SANDBOX and LIVE mode, clearly labeled. Use
  Twilio sandbox and Uber sandbox for testing. Default to sandbox to avoid accidental
  real bookings/charges.

## Architecture principles
- Build as a **tool-calling / function-calling agent**: the LLM interprets the
  client's text or voice request and selects the correct tool
  (book_ride, book_flight, send_message, set_reminder, call_contact).
- Each capability is a **separate, testable module** with a clean interface.
- The flight provider must be **swappable** behind an interface — no hardcoded vendor.
- **Cloud-ready from day one**: env-based config, no machine-specific absolute paths,
  containerizable (include a Dockerfile).
- Persist reminders, contacts, and conversation context in a datastore that **survives
  restarts** and works in the cloud.

## Critical constraints — DO NOT IGNORE
- **Twilio WhatsApp 24-hour window**: outside 24h since the user's last message, only
  pre-approved **template messages** may be sent. All proactive messaging (reminders,
  "message Ramesh", contact outreach) must account for this — surface and handle it.
- **Hinglish transcription** is the hardest input case. Document and justify the chosen
  approach and make it independently testable.
- **"Call if no response"** requires a scheduled **wait-and-check job** plus the
  persistent datastore above — it must survive the delay and restarts.
- **Contacts did not opt into a bot.** Note compliance/consent considerations for
  proactive outreach.

## Coding conventions
- Clear, readable code with descriptive names over cleverness.
- Validate and sanitize all external input (WhatsApp payloads, transcriptions) before acting.
- Every external API call: handle failures gracefully and log them — no silent failures.
- Confirm costly/destructive actions (booking, calling) before executing unless full
  auto-execution is explicitly enabled. In sandbox mode, never hit live endpoints.
- Centralized logging so errors flow to both the dev UI and standard logs.

## Secrets & config
- All keys/tokens in `.env`; `.env.example` lists every required variable name.
- Never commit `.env`. Ensure `.gitignore` excludes it.

## Workflow expectations for Claude Code
- Build the full system now; don't block on approval for the initial generation.
- After generating, summarize what was built and what to test first.
- Keep this file updated as the architecture solidifies.

## Build order (internal guide)
1. Scaffold + config loader (graceful on empty keys) + `.env.example` + `.gitignore`.
2. Datastore + logging foundation.
3. Developer UI shell with API connection tests + log view + sandbox toggle.
4. WhatsApp inbound/outbound via Twilio (text first, sandbox).
5. Agent core: LLM tool-calling loop with tools.
6. Voice transcription (English -> Hindi -> Hinglish).
7. Tool implementations: Uber, contact messaging, reminders, scheduled calls.
8. End-to-end local testing in sandbox.
9. Dockerfile + cloud deployment prep + README.