import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { z } from 'zod';
import prisma from '../config/prisma';

const router = Router();
router.use(authenticate as any);

// ─── Configuration ───────────────────────────────
// OpenClaw or direct AI provider config stored in Settings
interface AIConfig {
  provider: 'openclaw' | 'gemini' | 'openai' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  model: string;
}

async function getAIConfig(): Promise<AIConfig | null> {
  // 1. DB config first — user's explicit choice from the UI always wins
  const row = await prisma.appConfig.findUnique({ where: { key: 'ai_config' } });
  if (row?.value) {
    try {
      return JSON.parse(row.value) as AIConfig;
    } catch { /* fall through */ }
  }

  // 2. OpenClaw — preferred (has memory, sessions, database access)
  const openclawToken = process.env.OPENCLAW_GATEWAY_TOKEN;
  const openclawUrl = process.env.OPENCLAW_URL || (openclawToken ? 'http://openclaw.railway.internal:18789' : '');
  if (openclawUrl && openclawToken) {
    return {
      provider: 'openclaw',
      baseUrl: openclawUrl,
      apiKey: openclawToken,
      model: 'openclaw',
    };
  }

  // 3. Gemini fallback
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    return {
      provider: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com',
      apiKey: geminiKey,
      model: 'gemini-2.5-flash',
    };
  }

  // 4. Anthropic fallback
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    return {
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: anthropicKey,
      model: 'claude-sonnet-4-20250514',
    };
  }

  return null;
}

// ─── POST /chat — Proxy chat to AI provider ──────
const chatSchema = z.object({
  message: z.string().min(1).max(2000),
  context: z.string().optional(),        // page context: "fermentation", "invoices", etc.
  sessionKey: z.string().optional(),      // for conversation continuity
});

router.post('/chat', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { message, context, sessionKey } = chatSchema.parse(req.body);

  const config = await getAIConfig();
  if (!config) {
    res.status(503).json({ error: 'AI not configured. Add OPENCLAW_URL and OPENCLAW_GATEWAY_TOKEN env vars, or configure in Settings.' });
    return;
  }

  // Build system context based on which page the user is on
  const systemPrompt = buildSystemPrompt(context, req.user?.name);

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: message },
  ];

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`,
  };

  // OpenClaw-specific headers for session persistence
  if (config.provider === 'openclaw') {
    if (sessionKey) {
      headers['x-openclaw-session-key'] = sessionKey;
    }
    // Use the ERP user's ID for session routing
    headers['x-openclaw-message-channel'] = 'erp-chat';
  }

  let apiUrl: string;
  let body: Record<string, unknown>;

  switch (config.provider) {
    case 'openclaw':
      apiUrl = `${config.baseUrl}/v1/chat/completions`;
      body = { model: config.model, messages, stream: false, user: req.user?.id };
      break;
    case 'gemini':
      apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;
      body = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: message }] }],
        generationConfig: { maxOutputTokens: 1024 },
      };
      delete headers['Authorization']; // Gemini uses key in URL
      break;
    case 'openai':
      apiUrl = 'https://api.openai.com/v1/chat/completions';
      body = { model: config.model || 'gpt-4o-mini', messages, stream: false };
      break;
    case 'anthropic':
      apiUrl = 'https://api.anthropic.com/v1/messages';
      headers['x-api-key'] = config.apiKey;
      headers['anthropic-version'] = '2023-06-01';
      body = { model: config.model || 'claude-sonnet-4-20250514', max_tokens: 1024, system: systemPrompt, messages: [{ role: 'user', content: message }] };
      break;
    default:
      res.status(400).json({ error: `Unsupported provider: ${config.provider}` });
      return;
  }

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000), // 30s timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`AI API error (${config.provider}):`, response.status, errorText.slice(0, 200));
      res.status(502).json({ error: 'AI service returned an error. Please try again.' });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await response.json();

    // Normalize response across providers
    let reply: string;
    switch (config.provider) {
      case 'openclaw':
      case 'openai':
        reply = data.choices?.[0]?.message?.content ?? 'No response';
        break;
      case 'gemini':
        reply = data.candidates?.[0]?.content?.parts?.[0]?.text ?? 'No response';
        break;
      case 'anthropic':
        reply = data.content?.[0]?.text ?? 'No response';
        break;
      default:
        reply = 'No response';
    }

    res.json({
      reply,
      provider: config.provider,
      model: config.model,
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    if (errMsg.includes('timeout') || errMsg.includes('abort')) {
      res.status(504).json({ error: 'AI request timed out. Please try again.' });
    } else {
      console.error('AI proxy error:', errMsg);
      res.status(502).json({ error: 'Failed to reach AI service.' });
    }
  }
}));

// ─── GET /config — Get current AI config (admin only) ──────
router.get('/config', asyncHandler(async (req: AuthRequest, res: Response) => {
  const config = await getAIConfig();
  if (!config) {
    res.json({ configured: false });
    return;
  }
  // Don't leak full API key
  res.json({
    configured: true,
    provider: config.provider,
    model: config.model,
    baseUrl: config.provider === 'openclaw' ? config.baseUrl : undefined,
    keyHint: config.apiKey ? `...${config.apiKey.slice(-6)}` : undefined,
  });
}));

// ─── PUT /config — Save AI config (admin only) ──────
const configSchema = z.object({
  provider: z.enum(['openclaw', 'gemini', 'openai', 'anthropic']),
  baseUrl: z.string().optional(),
  apiKey: z.string().min(1),
  model: z.string().optional(),
});

router.put('/config', asyncHandler(async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'ADMIN') {
    res.status(403).json({ error: 'Admin only' });
    return;
  }
  const { provider, baseUrl, apiKey, model } = configSchema.parse(req.body);

  const config: AIConfig = {
    provider,
    baseUrl: baseUrl || '',
    apiKey,
    model: model || getDefaultModel(provider),
  };

  await prisma.appConfig.upsert({
    where: { key: 'ai_config' },
    update: { value: JSON.stringify(config) },
    create: { key: 'ai_config', value: JSON.stringify(config) },
  });

  res.json({ ok: true, provider, model: config.model });
}));

// ─── Helpers ──────────────────────────────────────

function getDefaultModel(provider: string): string {
  switch (provider) {
    case 'openclaw': return 'openclaw';
    case 'gemini': return 'gemini-2.5-flash';
    case 'openai': return 'gpt-4o-mini';
    case 'anthropic': return 'claude-sonnet-4-20250514';
    default: return '';
  }
}

function buildSystemPrompt(pageContext?: string, userName?: string): string {
  let prompt = `You are an AI assistant for MSPIL Distillery ERP — an ethanol plant management system for Mahakaushal Sugar & Power Industries Ltd.
The plant produces ethanol from grain (broken rice, maize) through milling, liquefaction, fermentation, and distillation.
Key products: Ethanol (ENA, RS, Fuel Ethanol), DDGS (animal feed byproduct), CO2.
The ERP tracks: grain intake, fermentation batches, distillation, ethanol production/dispatch, DDGS production, sales orders, invoices, procurement, inventory, and accounts.

Answer concisely. Use Indian number formatting (lakhs, crores). Assume IST timezone.`;

  if (userName) {
    prompt += `\nUser: ${userName}`;
  }

  if (pageContext) {
    const contextMap: Record<string, string> = {
      'dashboard': 'User is on the main Dashboard viewing KPIs across all modules.',
      'fermentation': 'User is on the Fermentation page — tracks batch phases (yeast, fermentation, beer well), hourly readings (level, gravity, alcohol %).',
      'distillation': 'User is on the Distillation page — tracks ethanol strength, RC strength, production volumes.',
      'grain': 'User is on the Grain/Raw Material page — tracks grain unloading, moisture, starch, silo levels.',
      'ethanol-product': 'User is on Ethanol Production page — tracks daily production in BL/AL, tank dips, dispatch.',
      'ddgs': 'User is on DDGS page — tracks dried distillers grain production, bag counts, dispatch.',
      'sales': 'User is on Sales — orders, dispatch requests, shipments, invoices.',
      'invoices': 'User is on Invoices — GST invoices with IRN, e-way bills, payment tracking.',
      'procurement': 'User is on Procurement — purchase orders, goods receipts, vendor invoices.',
      'inventory': 'User is on Inventory — material master, stock levels, movements, reorder rules.',
      'accounts': 'User is on Accounts — chart of accounts, journal entries, ledger, trial balance, P&L.',
      'payments': 'User is on Payments — receivables, payables, payment reconciliation.',
    };
    const ctx = contextMap[pageContext] || `User is viewing: ${pageContext}`;
    prompt += `\n\nCurrent page context: ${ctx}`;
  }

  return prompt;
}

export default router;
