/**
 * AI Chat Service — answers questions about the plant using Claude or Gemini + DB queries
 */
import prisma from '../config/prisma';

// ── DB Schema summary for the AI ──
const DB_SCHEMA = `
You are MSPIL Plant Assistant — an AI for Mahakaushal Sugar and Power Industries Ltd, a grain-based ethanol distillery in Narsinghpur, MP.

Key tables you can query (PostgreSQL via Prisma, use raw SQL):
- "MillingEntry" — date, sieve_1mm, sieve_850, sieve_600, sieve_300, totalFine, millA_rpm, millA_load, millB_rpm, millB_load, millC_rpm, millC_load
- "FermentationEntry" — date, batchNo, mashTemp, mashPH, yeastPitchRate, etc.
- "FermentationBatch" — batchNo, status (FILLING/FERMENTING/DONE/DISTILLING/COMPLETED), startTime, endTime, washStrength, peakTemp
- "DistillationEntry" — date, feedRate, rsAlcohol, rsTemp, enaAlcohol, enaTemp, fuselOil, etc.
- "EvaporationEntry" — date, syrupBrix, syrupFlow, steamPressure, etc.
- "EthanolProductEntry" — date, gradeNA/gradeENA/gradeRS quantities, totalProduction, strength
- "DispatchTruck" — date, vehicleNo, partyName, product, quantityBL, quantityKL, strength
- "DDGSStockEntry" — date, openingStock, productionToday, dispatchToday, closingStock
- "DDGSDispatchTruck" — date, vehicleNo, partyName, bags, weightNet
- "GrainTruck" — date, vehicleNo, vendorName, weightGross, weightTare, weightNet
- "GrainEntry" — date, grainReceived, grainIssued, openingStock, closingStock
- "DailyEntry" — date, section, shift, JSON data field with process parameters
- "SalesOrder" — orderNo, status, customerName, grandTotal; related "SalesOrderLine" (productName, quantity, rate)
- "DispatchRequest" — drNo, status, productName, quantity, customerName, destination, transporterName, freightRate
- "Shipment" — vehicleNo, status (GATE_IN/TARE_WEIGHED/LOADING/GROSS_WEIGHED/RELEASED/EXITED), weightTare, weightGross, weightNet, customerName, productName
- "Customer" — name, city, state, phone, contactPerson, gstNo
- "Transporter" — name, phone, vehicleCount
- "Invoice" — invoiceNo, customerName, totalAmount, status
- "Payment" — amount, mode, reference, customerName
- "PlantIssue" — title, description, priority, status, section
- "TankDip" — date, tankNo, dip, volume, temperature, strength, product

When answering:
- Always query the DB for current data. Don't guess numbers.
- Keep answers concise — this is WhatsApp, not an essay.
- Use simple text formatting (no markdown, no HTML). Use line breaks for readability.
- Include relevant numbers with units (MT, KL, BL, %, ₹).
- For "how's the plant" type questions, summarize: today's production, active fermentation batches, dispatch status, any open issues.
- Respond in the same language the user writes in (Hindi/English/Hinglish).
- All weights in DB are in kg, convert to MT (÷1000) or tons for display.
- All dates are stored as ISO timestamps.
`;

// ── Execute raw SQL safely ──
async function executeQuery(sql: string): Promise<any> {
  try {
    // Only allow SELECT queries
    const trimmed = sql.trim().toUpperCase();
    if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('WITH')) {
      return { error: 'Only SELECT queries are allowed' };
    }
    // Block dangerous keywords
    if (/\b(DROP|DELETE|UPDATE|INSERT|ALTER|TRUNCATE|EXEC|GRANT)\b/i.test(sql)) {
      return { error: 'Mutating queries are not allowed' };
    }
    const result = await prisma.$queryRawUnsafe(sql);
    // Limit result size for token efficiency
    const rows = Array.isArray(result) ? result.slice(0, 50) : result;
    return { rows, count: Array.isArray(result) ? result.length : 1 };
  } catch (err: any) {
    return { error: err.message?.slice(0, 200) };
  }
}

// ── Claude API ──
async function chatWithClaude(message: string, conversationHistory: { role: string; content: string }[]): Promise<string> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const tools: any[] = [{
    name: 'query_database',
    description: 'Execute a read-only SQL query against the plant PostgreSQL database. Use double quotes for table/column names (PostgreSQL). Returns rows as JSON.',
    input_schema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'The SELECT SQL query to execute' },
        purpose: { type: 'string', description: 'Brief explanation of what this query fetches' },
      },
      required: ['sql'],
    },
  }];

  const messages = [
    ...conversationHistory.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user' as const, content: message },
  ];

  let response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: DB_SCHEMA,
    tools,
    messages,
  });

  // Handle tool use loops (max 5 iterations)
  let iterations = 0;
  while (response.stop_reason === 'tool_use' && iterations < 5) {
    iterations++;
    const toolUseBlocks = response.content.filter((b: any) => b.type === 'tool_use');
    const toolResults: any[] = [];

    for (const block of toolUseBlocks) {
      const tb = block as any;
      if (tb.name === 'query_database') {
        console.log(`[AI] SQL: ${tb.input.sql}`);
        const result = await executeQuery(tb.input.sql);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tb.id,
          content: JSON.stringify(result).slice(0, 4000), // Token limit
        });
      }
    }

    response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: DB_SCHEMA,
      tools,
      messages: [
        ...messages,
        { role: 'assistant', content: response.content },
        { role: 'user', content: toolResults },
      ],
    });
  }

  // Extract text response
  const textBlocks = response.content.filter((b: any) => b.type === 'text');
  return textBlocks.map((b: any) => b.text).join('\n') || 'Sorry, I could not process that.';
}

// ── Gemini API ──
async function chatWithGemini(message: string, conversationHistory: { role: string; content: string }[]): Promise<string> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  // Gemini doesn't have native tool use as cleanly, so we do a 2-step approach:
  // Step 1: Ask Gemini what SQL to run
  const sqlPrompt = `${DB_SCHEMA}\n\nUser question: "${message}"\n\nRespond with ONLY the SQL query needed to answer this (PostgreSQL syntax, double-quote table names). If multiple queries needed, separate with semicolons. If no query needed, respond with "NONE".`;

  const sqlResult = await model.generateContent(sqlPrompt);
  const sqlText = sqlResult.response.text().trim();

  let dbContext = '';
  if (sqlText !== 'NONE' && sqlText.toUpperCase().startsWith('SELECT')) {
    // Execute each query
    const queries = sqlText.split(';').filter(q => q.trim());
    for (const q of queries.slice(0, 3)) {
      const result = await executeQuery(q.trim());
      dbContext += `\nQuery: ${q.trim()}\nResult: ${JSON.stringify(result).slice(0, 3000)}\n`;
    }
  }

  // Step 2: Generate answer with DB context
  const answerPrompt = `${DB_SCHEMA}\n\nUser: ${message}\n${dbContext ? `\nDatabase results:\n${dbContext}` : ''}\n\nRespond concisely for WhatsApp. Include numbers with units.`;

  const history = conversationHistory.map(m => ({
    role: m.role === 'assistant' ? 'model' as const : 'user' as const,
    parts: [{ text: m.content }],
  }));

  const chat = model.startChat({ history });
  const result = await chat.sendMessage(answerPrompt);
  return result.response.text() || 'Sorry, I could not process that.';
}

// ── Main chat function — picks provider based on env ──
export async function chat(message: string, conversationHistory: { role: string; content: string }[] = []): Promise<string> {
  try {
    if (process.env.ANTHROPIC_API_KEY) {
      return await chatWithClaude(message, conversationHistory);
    } else if (process.env.GOOGLE_API_KEY) {
      return await chatWithGemini(message, conversationHistory);
    } else {
      return 'AI not configured. Set ANTHROPIC_API_KEY or GOOGLE_API_KEY in Railway env vars.';
    }
  } catch (err: any) {
    console.error('[AI Chat] Error:', err.message);
    return `Error: ${err.message?.slice(0, 100)}`;
  }
}

export { executeQuery, DB_SCHEMA };
