// -----------------------------------------------------------------------------
// The agent loop: Claude interprets the client's natural-language/voice request
// and calls tools until it has a final answer for the client.
// -----------------------------------------------------------------------------
import { createMessage } from '../services/claude.js';
import { isSandbox, config } from '../config.js';
import { logger } from '../logger.js';
import { TOOL_SCHEMAS, runTool } from './tools.js';
import { getConversation } from '../store/store.js';

const MAX_TURNS = 6; // tool-call rounds before we force a textual answer

function systemPrompt() {
  const now = new Date();
  return [
    `You are a personal WhatsApp assistant for ${config.owner.name}. You chat with them like a `,
    `helpful friend over text, and you take real actions on their behalf using tools.`,
    ``,
    `CURRENT DATE/TIME: ${now.toString()} (ISO: ${now.toISOString()}).`,
    `Use this to convert relative times ("tomorrow 5pm", "in 2 hours") into absolute ISO timestamps.`,
    ``,
    `MODE: ${isSandbox() ? 'SANDBOX (no real bookings/calls happen; safe to test)' : 'LIVE (real actions!)'}.`,
    ``,
    `CAPABILITIES (via tools): book Uber rides, message the client's contacts on WhatsApp,`,
    `set reminders for the client or contacts, place phone calls, and "message someone and`,
    `call them if they don't reply".`,
    `(Flight booking is not available — if asked, say it isn't supported yet.)`,
    ``,
    `GUIDELINES:`,
    `- The person messaging you IS the client. "me"/"my"/"I" refers to them.`,
    `- For costly or irreversible actions (booking a ride/flight, placing a call), briefly CONFIRM`,
    `  the details first, unless the client was already explicit (e.g. "book it now").`,
    `- To message or remind a contact you need them in the address book. If a name isn't found,`,
    `  ask for their phone number and use add_contact.`,
    `- WhatsApp only allows free-form messages to a contact within 24h of THEIR last message to the`,
    `  bot. If a tool reports the window is closed, clearly explain this limit to the client instead`,
    `  of pretending the message was sent.`,
    `- The client may write in English, Hindi, or Hinglish (and voice notes are transcribed to text).`,
    `  Understand all of these and reply in the same language/style the client used.`,
    `- Keep replies short and conversational — this is WhatsApp. Confirm what you did.`,
    `- Never invent results. If a tool fails, tell the client plainly what went wrong.`,
  ].join('\n');
}

// Build Anthropic-format message history from stored conversation turns.
function buildHistory(number) {
  const conv = getConversation(number);
  return conv.history.map((h) => ({
    role: h.role === 'assistant' ? 'assistant' : 'user',
    content: h.text,
  }));
}

// Run the agent for one inbound user message. Returns the assistant's reply text.
export async function runAgent({ from, text }) {
  const messages = [
    ...buildHistory(from),
    { role: 'user', content: text },
  ];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let res;
    try {
      res = await createMessage({
        max_tokens: 1024,
        system: systemPrompt(),
        tools: TOOL_SCHEMAS,
        messages,
      });
    } catch (err) {
      logger.error('agent', 'Claude call failed', { error: err.message });
      return `Sorry — my brain (Claude) is unreachable right now: ${err.message}`;
    }

    // Collect any tool uses in this response.
    const toolUses = res.content.filter((b) => b.type === 'tool_use');

    if (res.stop_reason !== 'tool_use' || toolUses.length === 0) {
      // Final textual answer.
      const textOut = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      return textOut || 'Done.';
    }

    // Record the assistant turn (with tool_use blocks) then execute the tools.
    messages.push({ role: 'assistant', content: res.content });

    const toolResults = [];
    for (const tu of toolUses) {
      const result = await runTool(tu.name, tu.input, { from });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result),
        is_error: result && result.ok === false,
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  return "I wasn't able to finish that in a few steps — could you rephrase or break it down?";
}
