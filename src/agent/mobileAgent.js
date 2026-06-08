// -----------------------------------------------------------------------------
// Mobile agent "interpreter".
//
// Unlike the WhatsApp agent (which EXECUTES tools on the server), the mobile app
// executes actions ON THE DEVICE using the user's own permissions (contacts,
// calendar, notifications, WhatsApp). So here Claude's job is only to UNDERSTAND
// the request and return ONE structured action for the app to carry out.
//
// Claude is forced to call exactly one tool; we return {tool, input} as JSON.
// Each tool includes a `say` field — a short, friendly confirmation in the SAME
// language/style the user used (English / Hindi / Hinglish).
// -----------------------------------------------------------------------------
import { createMessage } from '../services/claude.js';
import { config } from '../config.js';

const TOOLS = [
  {
    name: 'send_whatsapp',
    description:
      'User wants to send a WhatsApp message to someone in their contacts. ' +
      'Extract the contact NAME as the user said it and the message body.',
    input_schema: {
      type: 'object',
      properties: {
        contactName: { type: 'string', description: 'The person to message, e.g. "Ramesh".' },
        message: { type: 'string', description: 'The message body to send.' },
        say: { type: 'string', description: 'Short friendly confirmation in the user\'s language.' },
      },
      required: ['contactName', 'message', 'say'],
    },
  },
  {
    name: 'create_calendar_event',
    description:
      'User wants to schedule a meeting / event. Convert any relative time ' +
      '("tomorrow 5pm", "kal subah 9 baje") into an absolute ISO 8601 timestamp ' +
      'using the provided current date/time.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Event title, e.g. "Meeting with Ramesh".' },
        startISO: { type: 'string', description: 'Absolute start time, ISO 8601.' },
        durationMinutes: { type: 'integer', description: 'Duration in minutes (default 60).' },
        say: { type: 'string', description: 'Short friendly confirmation in the user\'s language.' },
      },
      required: ['title', 'startISO', 'say'],
    },
  },
  {
    name: 'set_reminder',
    description:
      'User wants a reminder/notification at a specific time. Convert relative ' +
      'time into an absolute ISO 8601 timestamp using the current date/time.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'What to remind them about.' },
        whenISO: { type: 'string', description: 'Absolute time, ISO 8601.' },
        say: { type: 'string', description: 'Short friendly confirmation in the user\'s language.' },
      },
      required: ['text', 'whenISO', 'say'],
    },
  },
  {
    name: 'save_note',
    description:
      'User wants to jot down / remember a note, idea, or piece of information ' +
      '(e.g. "note that the client wants blue packaging", "remember to buy milk", ' +
      '"likh lo: invoice pending hai"). Capture the note text cleanly.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The note content to save.' },
        say: { type: 'string', description: 'Short friendly confirmation in the user\'s language.' },
      },
      required: ['text', 'say'],
    },
  },
  {
    name: 'list_notes',
    description:
      'User wants to see / read back their saved notes (e.g. "show my notes", ' +
      '"meri notes dikhao", "what did I note down?").',
    input_schema: {
      type: 'object',
      properties: {
        say: { type: 'string', description: 'Short lead-in in the user\'s language, e.g. "Here are your notes:".' },
      },
      required: ['say'],
    },
  },
  {
    name: 'check_email',
    description:
      'User wants to know about recent emails / who emailed them (e.g. "who ' +
      'mailed me today", "any new emails", "check my inbox", "aaj kisne mail ' +
      'kiya"). Optionally a number of days to look back.',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: 'How many days back to look (default 1 = today).' },
        say: { type: 'string', description: 'Short lead-in in the user\'s language, e.g. "Checking your inbox…".' },
      },
      required: ['say'],
    },
  },
  {
    name: 'read_email',
    description:
      'User wants to OPEN / READ a specific email in full (e.g. "open the Upwork ' +
      'email", "read Sajjad Hyder\'s email", "what did Ramesh say in his mail"). ' +
      'Provide a search query built from whatever the user named — a sender name, ' +
      'company, or subject keywords.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms: sender name, company, and/or subject words.' },
        say: { type: 'string', description: 'Short lead-in in the user\'s language, e.g. "Opening that email…".' },
      },
      required: ['query', 'say'],
    },
  },
  {
    name: 'send_email',
    description:
      'User wants to send/write an email to someone (e.g. "email Ramesh that the ' +
      'order shipped", "mail bhejo John ko"). Provide the recipient as the user ' +
      'named them (a name OR an email address), a subject, and the body.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient: an email address, or a contact name to look up.' },
        subject: { type: 'string', description: 'A short, sensible subject line.' },
        body: { type: 'string', description: 'The email body, written naturally.' },
        say: { type: 'string', description: 'Short friendly confirmation in the user\'s language.' },
      },
      required: ['to', 'subject', 'body', 'say'],
    },
  },
  {
    name: 'query_calendar',
    description:
      'User is asking about their schedule/meetings (e.g. "how many meetings ' +
      'today", "what\'s on tomorrow"). Provide the date they are asking about.',
    input_schema: {
      type: 'object',
      properties: {
        dateISO: { type: 'string', description: 'The date in question (ISO 8601 date, e.g. 2026-06-02).' },
        say: { type: 'string', description: 'Short lead-in in the user\'s language, e.g. "Here\'s your day:".' },
      },
      required: ['dateISO', 'say'],
    },
  },
  {
    name: 'reply',
    description: 'No actionable task — just chat / answer / clarify.',
    input_schema: {
      type: 'object',
      properties: {
        say: { type: 'string', description: 'The reply text in the user\'s language.' },
      },
      required: ['say'],
    },
  },
];

function systemPrompt(nowISO) {
  return [
    `You are a personal mobile assistant for ${config.owner.name}. The user talks to`,
    `you like a friend, in English, Hindi, or Hinglish (text or transcribed voice).`,
    ``,
    `LANGUAGE POLICY (STRICT): You ONLY understand and respond in English, Hindi, or`,
    `Hinglish (Hindi+English code-mixing, in Roman or Devanagari script). These are the`,
    `ONLY supported languages.`,
    `- If the user writes in ANY other language (e.g. Spanish, Arabic, French, Urdu,`,
    `  Bengali, Tamil, Chinese, etc.), DO NOT act on it. Instead use the "reply" tool`,
    `  with a polite message — in English — saying you only support English, Hindi, and`,
    `  Hinglish. Example say: "Sorry, I only understand English, Hindi, and Hinglish.`,
    `  Please send your request in one of those. 🙂"`,
    `- Proper nouns (names, places, brands) inside an otherwise English/Hindi/Hinglish`,
    `  sentence are fine — only refuse when the REQUEST ITSELF is in another language.`,
    `- Always keep your "say" replies in English, Hindi, or Hinglish — never another language.`,
    ``,
    `CURRENT DATE/TIME (device local): ${nowISO}.`,
    `Use this to turn relative times ("tomorrow 5pm", "kal subah 9 baje", "in 2 hours")`,
    `into absolute ISO 8601 timestamps.`,
    ``,
    `Pick EXACTLY ONE tool that best matches the request and call it. Always fill the`,
    `"say" field with a short, warm confirmation written in the SAME language/style the`,
    `user used (English, Hindi, or Hinglish only). Keep it brief and natural — this is a chat app.`,
    ``,
    `Guidance:`,
    `- "text/message/WhatsApp <name> ..." -> send_whatsapp.`,
    `- "set/schedule a meeting/event ..." -> create_calendar_event.`,
    `- "remind me ..." -> set_reminder.`,
    `- "note / remember / jot down / likh lo ..." -> save_note.`,
    `- "show/read my notes ..." -> list_notes.`,
    `- "who mailed me / any new email / check inbox ..." -> check_email.`,
    `- "open/read <the X> email / what did <person> say ..." -> read_email.`,
    `- "email/mail <someone> ..." -> send_email.`,
    `- "how many meetings / what's on my calendar / schedule ..." -> query_calendar.`,
    `- A request in an unsupported language -> reply (politely decline, in English).`,
    `- Anything else (greetings, questions, unclear) -> reply.`,
  ].join('\n');
}

// Returns { ok, tool, input } or { ok:false, error }.
export async function interpret({ text, nowISO }) {
  if (!text || !text.trim()) return { ok: false, error: 'Empty message.' };
  const now = nowISO || new Date().toISOString();

  const res = await createMessage({
    max_tokens: 600,
    system: systemPrompt(now),
    tools: TOOLS,
    tool_choice: { type: 'any' }, // force a tool call
    messages: [{ role: 'user', content: text }],
  });

  const toolUse = res.content.find((b) => b.type === 'tool_use');
  if (!toolUse) {
    // Fallback: treat any text as a reply.
    const txt = res.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
    return { ok: true, tool: 'reply', input: { say: txt || 'Okay.' } };
  }
  return { ok: true, tool: toolUse.name, input: toolUse.input };
}
