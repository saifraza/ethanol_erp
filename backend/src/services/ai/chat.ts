/**
 * Chat orchestrator — the user's message goes here.
 *
 * Flow:
 *   1. Build system prompt + load all CHAT_TOOL features as Gemini function-call schemas
 *   2. Send to Gemini with the tool catalog
 *   3. If Gemini returns a function call: execute it, append result, ask Gemini to continue
 *   4. Loop up to 4 turns, return final answer + tool trace
 *
 * Stats are tracked in AI_USAGE map (in-memory for now; promote to DB if we
 * need historical analytics).
 */
import axios from 'axios';
import { getChatTools, getFeatureById, AI_FEATURES } from './registry';
import type { AIToolCallResult } from './types';

const MAX_TOOL_TURNS = 4;
const GEMINI_MODEL = 'gemini-2.5-flash';

interface UsageStat {
  featureId: string;
  invocations: number;
  errors: number;
  lastInvokedAt: string | null;
  lastErrorMessage: string | null;
}

const AI_USAGE = new Map<string, UsageStat>();

export function getUsageStats(): UsageStat[] {
  return AI_FEATURES.map(f => AI_USAGE.get(f.id) || {
    featureId: f.id, invocations: 0, errors: 0, lastInvokedAt: null, lastErrorMessage: null,
  });
}

function trackInvocation(featureId: string, error?: string) {
  const cur = AI_USAGE.get(featureId) || { featureId, invocations: 0, errors: 0, lastInvokedAt: null, lastErrorMessage: null };
  cur.invocations++;
  if (error) { cur.errors++; cur.lastErrorMessage = error; }
  cur.lastInvokedAt = new Date().toISOString();
  AI_USAGE.set(featureId, cur);
}

function buildGeminiFunctionDeclarations() {
  return getChatTools().map(t => ({
    name: t.id.replace(/\./g, '__'), // Gemini doesn't allow dots in function names
    description: t.description,
    parameters: {
      type: 'object',
      properties: Object.fromEntries(
        (t.parameters || []).map(p => [p.name, {
          type: p.type === 'date' ? 'string' : p.type,
          description: p.description + (p.type === 'date' ? ' Format: YYYY-MM-DD.' : ''),
        }])
      ),
      required: (t.parameters || []).filter(p => p.required).map(p => p.name),
    },
  }));
}

function buildSystemPrompt(pageContext: string | undefined, userName: string | undefined): string {
  const todayIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const yyyy = todayIST.getUTCFullYear();
  const mm = String(todayIST.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(todayIST.getUTCDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;
  const monthName = ['January','February','March','April','May','June','July','August','September','October','November','December'][todayIST.getUTCMonth()];
  const fyStartYr = todayIST.getUTCMonth() >= 3 ? yyyy : yyyy - 1;

  let prompt = `You are the MSPIL Distillery ERP reporting assistant. Plant: ethanol from grain (broken rice / maize) via mill → liquefaction → fermentation → distillation. Byproducts: DDGS, CO2.

TODAY (IST) = ${todayStr} (${monthName} ${yyyy}).
Current FY = FY${fyStartYr}-${String(fyStartYr + 1).slice(-2)} (1-Apr-${fyStartYr} to 31-Mar-${fyStartYr + 1}).
Timezone: Asia/Kolkata (IST, UTC+5:30).

═══ HARD RULES ═══
1. ALWAYS call a tool. Never ask clarifying questions about data the user can query — guess sensibly and call the tool. Only re-ask if the user used a totally undefined entity.
2. Convert ALL relative dates to absolute YYYY-MM-DD before calling tools. NEVER pass "today" or "5th" as the literal string.
3. Pick the most specific tool. "How many trucks of X" → get_truck_arrivals. "Pay" → get_outstanding_payables. "Production" → get_ethanol_production. "Account balance" → get_account_balance.
4. If NO specific tool matches: call list_tables → describe_table for the relevant model → query_table with a Prisma where/orderBy/limit. This is your fallback for any data anywhere in the DB.
5. READ-ONLY. You cannot write, update, or delete. Don't promise to "create", "update", or "delete" — only read.
6. After the tool returns, answer in 1-3 short sentences with the headline number. If the answer is a list, say "I have N rows — click Download Excel for the full list."
7. Use Indian numbering: 1,00,000 = 1 lakh, 1,00,00,000 = 1 crore. Currency = ₹.

═══ DATE PARSING (MUST be exact) ═══
- "today" → ${todayStr}
- "yesterday" → ${new Date(Date.now() - 86400000 + 5.5 * 3600000).toISOString().slice(0, 10)}
- "this month" → from = ${yyyy}-${mm}-01 to = ${todayStr}
- "last month" → previous full calendar month (full range)
- "5th" / "5 th" → ${yyyy}-${mm}-05
- "5th to 9th this month" → from = ${yyyy}-${mm}-05, to = ${yyyy}-${mm}-09
- "from 5th" → from = ${yyyy}-${mm}-05, to = ${todayStr}
- "last 7 days" → from = (today - 6) to = ${todayStr} (inclusive 7-day window)
- "this week" → Monday of this week to ${todayStr}
- "this FY" / "current FY" → from = ${fyStartYr}-04-01, to = ${todayStr}
- "April" without year → April of current FY (use ${fyStartYr})
- A year alone "2025" → from = 2025-04-01, to = 2026-03-31 (FY interpretation)

═══ DOMAIN VOCABULARY ═══
- INCOMING trucks (grain, coal, husk, briquette arriving at the plant) → get_truck_arrivals (queries GrainTruck / weighbridge-in)
- OUTGOING ethanol trucks (dispatches, liftings, tanker going OUT to OMC/customer) → get_ethanol_dispatches (queries EthanolLifting). Use for ANY "ethanol truck" / "ethanol dispatch" / "tanker" / "lifting" question.
- GRN / receipts / deliveries inwards (without truck context) → get_grns
- "fuel" alone = boiler fuel (coal/husk/briquette/wood) — INCOMING. NOT fuel ethanol the product. Only "fuel ethanol" / "FE" means the product (OUTGOING).
- Materials (incoming): RICE_HUSK, BROKEN_RICE, MAIZE, COAL, HUSK (husk = rice husk), BRIQUETTE, WOOD, BAGASSE, DDGS
- Products (outgoing): ENA = Extra Neutral Alcohol; RS = Rectified Spirit; FE = Fuel Ethanol
- OMCs (buyers of ethanol): HPCL, IOCL, BPCL, IOC, Mash Biotech
- "ofc" = "of course" — casual confirmation, NOT an acronym. Treat the rest of the message as the actual query.
- Divisions: SUGAR, POWER, ETHANOL, COMMON

DIRECTION RULE — critical:
- "ethanol trucks came" / "ethanol trucks" / "ethanol tankers" / "FE trucks" / "ethanol dispatched" / "how many tanker loaded" → get_ethanol_dispatches (OUTGOING)
- "trucks came" / "trucks arrived" (no product specified, or product is coal/grain/husk) → get_truck_arrivals (INCOMING)
- "trucks today" without context → get_ethanol_dispatches (since ethanol is the main revenue output)

═══ EXAMPLE TOOL CALLS ═══
User: "how many trucks of rice husk came from 5th to 9th this month"
→ get_truck_arrivals({ from: "${yyyy}-${mm}-05", to: "${yyyy}-${mm}-09", material: "RICE HUSK" })

User: "any ethanol trucks that came today?" / "ethanol dispatches today" / "how many tankers went today"
→ get_ethanol_dispatches({ from: "${todayStr}", to: "${todayStr}" })

User: "ethanol to HPCL this month"
→ get_ethanol_dispatches({ from: "${yyyy}-${mm}-01", to: "${todayStr}", buyer: "HPCL" })

User: "ofc consumed" (after asking about fuel)
→ Treat as confirmation. Answer with the latest fuel inflow data already fetched, OR call get_fuel_inflow for the current month.

User: "outstanding to vendors > 5L"
→ get_outstanding_payables({ minBalance: 500000 })

User: "TDS payable"
→ get_account_balance({ accountQuery: "TDS Payable" })`;

  if (userName) prompt += `\n\nUser: ${userName}`;
  if (pageContext) prompt += `\nUser is on page: ${pageContext}.`;
  return prompt;
}

export async function runChat(input: {
  message: string;
  pageContext?: string;
  userName?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<{
  reply: string;
  provider: string;
  model: string;
  toolCalls: AIToolCallResult[];
  turns: number;
}> {
  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY not set');

  const systemPrompt = buildSystemPrompt(input.pageContext, input.userName);
  const tools = [{ functionDeclarations: buildGeminiFunctionDeclarations() }];
  const toolCalls: AIToolCallResult[] = [];

  // Build conversation: history + current user message
  const contents: Array<{ role: string; parts: Array<{ text?: string; functionCall?: any; functionResponse?: any }> }> = [];
  for (const h of input.history || []) {
    contents.push({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.content }] });
  }
  contents.push({ role: 'user', parts: [{ text: input.message }] });

  let turns = 0;
  for (let i = 0; i < MAX_TOOL_TURNS; i++) {
    turns++;
    const geminiRes = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
      {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        tools,
        generationConfig: { maxOutputTokens: 1500, temperature: 0.2 },
      },
      { timeout: 30000 }
    );

    const candidate = geminiRes.data?.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    // Check for function call in any part
    const fnCallPart = parts.find((p: any) => p.functionCall);
    if (fnCallPart) {
      const fnName: string = fnCallPart.functionCall.name;
      const fnArgs = fnCallPart.functionCall.args || {};
      const featureId = fnName.replace(/__/g, '.');
      const feature = getFeatureById(featureId);

      const start = Date.now();
      let result: unknown = null;
      let errMsg: string | undefined = undefined;
      if (!feature) {
        errMsg = `Unknown tool: ${fnName}`;
      } else {
        try {
          result = await feature.execute(fnArgs);
        } catch (err: any) {
          errMsg = err.message || 'Tool execution failed';
        }
      }
      trackInvocation(featureId, errMsg);
      toolCalls.push({ toolId: featureId, args: fnArgs, result, error: errMsg, durationMs: Date.now() - start });

      // Append model's tool call + our function response, then loop
      contents.push({ role: 'model', parts: [{ functionCall: fnCallPart.functionCall }] });
      contents.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name: fnName,
            response: errMsg ? { error: errMsg } : { result },
          } as any,
        }],
      });
      continue;
    }

    // No tool call — extract text reply
    const textPart = parts.find((p: any) => p.text);
    const reply = textPart?.text || 'I could not generate a response.';
    return { reply, provider: 'gemini', model: GEMINI_MODEL, toolCalls, turns };
  }

  return {
    reply: 'I made several tool calls but could not finalize an answer. Try a more specific question.',
    provider: 'gemini',
    model: GEMINI_MODEL,
    toolCalls,
    turns,
  };
}
