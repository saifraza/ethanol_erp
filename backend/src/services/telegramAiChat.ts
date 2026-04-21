/**
 * Telegram AI chat handler
 *
 * Triggers: messages starting with /ai, /ask, or @mention.
 *   /ai how many trucks came today
 *   /ask outstanding to vendors > 5L
 *
 * Uses the same runChat() service function that powers the in-app chat widget,
 * so the behaviour is identical — tool calling, date parsing, everything.
 *
 * Per-chat conversation history is kept in memory (up to 20 turns) so follow-up
 * questions like "and for rice husk?" work naturally.
 */
import { registerIncomingHandler, sendTelegramMessage } from './telegramBot';
import { runChat } from './ai/chat';

const MAX_HISTORY = 20;
const CHAT_HISTORY = new Map<string, Array<{ role: 'user' | 'assistant'; content: string }>>();
const TRIGGER_RE = /^\/?(ai|ask)\b\s*/i;

function shouldHandle(text: string): { handle: boolean; query: string } {
  const t = text.trim();
  if (!t) return { handle: false, query: '' };

  // /ai ... or /ask ...
  const match = t.match(TRIGGER_RE);
  if (match) {
    return { handle: true, query: t.slice(match[0].length).trim() };
  }
  // /start or /help — give a short hint
  if (/^\/(start|help)\b/i.test(t)) {
    return { handle: true, query: '__HELP__' };
  }
  return { handle: false, query: '' };
}

async function handleAiMessage(chatId: string, text: string, name: string | null): Promise<boolean> {
  const { handle, query } = shouldHandle(text);
  if (!handle) return false;

  if (query === '__HELP__') {
    await sendTelegramMessage(chatId,
      `🤖 *MSPIL AI Assistant*\n\n` +
      `Ask me anything about the ERP. Examples:\n\n` +
      `\`/ai how many trucks came today\`\n` +
      `\`/ai outstanding to vendors > 5 lakhs\`\n` +
      `\`/ai TDS payable balance\`\n` +
      `\`/ai ethanol production this month\`\n` +
      `\`/ai rice husk inflow 5th to 9th\`\n\n` +
      `Follow-up questions remember context. Use \`/ai reset\` to clear chat history.`
    );
    return true;
  }

  if (!query) {
    await sendTelegramMessage(chatId, `Usage: \`/ai <your question>\` — e.g. \`/ai how many trucks came today\``);
    return true;
  }

  // Reset command
  if (/^reset\b/i.test(query)) {
    CHAT_HISTORY.delete(chatId);
    await sendTelegramMessage(chatId, `✓ Chat history cleared.`);
    return true;
  }

  // Acknowledge (Telegram has a 4s typical SLA before user thinks nothing happened)
  await sendTelegramMessage(chatId, `_Thinking..._`);

  try {
    const history = CHAT_HISTORY.get(chatId) || [];
    const result = await runChat({
      message: query,
      userName: name || undefined,
      history,
    });

    // Update history
    const newHistory = [
      ...history,
      { role: 'user' as const, content: query },
      { role: 'assistant' as const, content: result.reply },
    ].slice(-MAX_HISTORY);
    CHAT_HISTORY.set(chatId, newHistory);

    // Send reply with tool trace as markdown
    let out = result.reply;
    if (result.toolCalls && result.toolCalls.length > 0) {
      const trace = result.toolCalls.map(tc => {
        const short = tc.toolId.split('.').pop();
        return `  • \`${short}\` (${tc.durationMs}ms)${tc.error ? ' ❌' : ''}`;
      }).join('\n');
      out += `\n\n_🔧 Tools used (${result.toolCalls.length}):_\n${trace}`;
    }

    // Telegram message limit is 4096 chars — truncate if needed
    if (out.length > 4000) out = out.slice(0, 3990) + '\n\n_(truncated — use the web app for full data)_';

    await sendTelegramMessage(chatId, out);
  } catch (err: any) {
    await sendTelegramMessage(chatId, `⚠️ AI error: ${err?.message || 'unknown'}`);
  }

  return true;
}

export function initTelegramAiChat() {
  registerIncomingHandler(handleAiMessage);
  console.log('[Telegram AI] chat handler registered — use /ai or /ask to query the ERP');
}
