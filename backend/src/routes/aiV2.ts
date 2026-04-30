/**
 * AI v2 routes — unified chat with tool-calling + features admin + excel export.
 * Coexists with the legacy /api/ai/chat (now obsolete but kept for compat).
 *
 * Endpoints:
 *   POST /api/ai-v2/chat            — chat with tool-calling, returns answer + tool data
 *   POST /api/ai-v2/export-excel    — convert any tabular dataset to .xlsx download
 *   GET  /api/ai-v2/features        — list all registered AI features + usage stats
 */
import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { AI_FEATURES, getFeaturesByKind } from '../services/ai/registry';
import { runChat, getUsageStats } from '../services/ai/chat';

const router = Router();
router.use(authenticate);

// ─── AI access control ───────────────────────────
// AI has read-access to the entire database (invoices, payroll, loans,
// accounts, etc.) via the generic query_table tool. Restrict to roles with
// legitimate need-to-know. Extend the allow-list by setting AI_ALLOWED_ROLES
// env var (comma-separated).
const DEFAULT_ALLOWED = ['ADMIN', 'SUPER_ADMIN', 'OWNER', 'ACCOUNTS_MANAGER', 'FINANCE'];
const ALLOWED_ROLES = (process.env.AI_ALLOWED_ROLES || DEFAULT_ALLOWED.join(','))
  .split(',')
  .map(r => r.trim().toUpperCase())
  .filter(Boolean);

function requireAiAccess(req: AuthRequest, res: Response, next: NextFunction): void {
  const role = (req.user?.role || '').toUpperCase();
  if (!ALLOWED_ROLES.includes(role)) {
    res.status(403).json({ error: `AI is restricted to ${ALLOWED_ROLES.join(' / ')} roles. Your role: ${role || 'NONE'}` });
    return;
  }
  next();
}

router.use(requireAiAccess as any);

const chatSchema = z.object({
  message: z.string().min(1).max(4000),
  pageContext: z.string().optional(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).optional(),
});

router.post('/chat', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { message, pageContext, history } = chatSchema.parse(req.body);
  try {
    const result = await runChat({
      message,
      pageContext,
      userName: req.user?.name,
      history,
    });
    res.json(result);
  } catch (err: unknown) {
    res.status(502).json({ error: (err instanceof Error ? err.message : String(err)) || 'AI failed' });
  }
}));

// ─── Excel export ─────────────────────────────────
// Take any JSON array (typically a tool result) and stream a .xlsx file.
// The chat UI calls this with the data the AI just returned, so the user
// can save the same answer as an Excel report.
const exportSchema = z.object({
  title: z.string().min(1).max(120),
  sheets: z.array(z.object({
    name: z.string().min(1).max(31),
    rows: z.array(z.record(z.string(), z.any())),
    summary: z.record(z.string(), z.any()).optional(),
  })).min(1),
});

router.post('/export-excel', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { title, sheets } = exportSchema.parse(req.body);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'MSPIL ERP — AI Reports';
  wb.created = new Date();

  for (const sheetDef of sheets) {
    const ws = wb.addWorksheet(sheetDef.name.slice(0, 31));

    // Title row
    ws.mergeCells('A1:F1');
    ws.getCell('A1').value = title;
    ws.getCell('A1').font = { size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    ws.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left' };
    ws.getRow(1).height = 22;

    // Generated-on
    ws.getCell('A2').value = `Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })} IST`;
    ws.getCell('A2').font = { size: 9, italic: true, color: { argb: 'FF64748B' } };

    if (sheetDef.rows.length === 0) {
      ws.getCell('A4').value = 'No data';
      continue;
    }

    // Build columns from first row keys
    const cols = Object.keys(sheetDef.rows[0]);
    ws.columns = cols.map(c => ({
      header: c.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      key: c,
      width: Math.min(40, Math.max(10, c.length + 4)),
    }));

    // Push rows starting at row 4 (row 3 is the header)
    ws.spliceRows(1, 0, [], []); // shift down for title rows
    const headerRow = ws.getRow(3);
    headerRow.values = ws.columns.map(c => c.header as string);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
    headerRow.height = 18;

    sheetDef.rows.forEach((r, i) => {
      const row = ws.getRow(4 + i);
      cols.forEach((c, j) => { row.getCell(j + 1).value = r[c] ?? ''; });
      // Zebra
      if (i % 2 === 1) {
        row.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        });
      }
      // Number alignment
      cols.forEach((c, j) => {
        const v = r[c];
        if (typeof v === 'number') {
          row.getCell(j + 1).alignment = { horizontal: 'right' };
          row.getCell(j + 1).numFmt = '#,##0.00';
        }
      });
    });

    // Summary (if provided) — appended below table
    if (sheetDef.summary) {
      const summaryStartRow = 4 + sheetDef.rows.length + 2;
      ws.getCell(`A${summaryStartRow}`).value = 'Summary';
      ws.getCell(`A${summaryStartRow}`).font = { bold: true, size: 11 };
      let r = summaryStartRow + 1;
      for (const [k, v] of Object.entries(sheetDef.summary)) {
        ws.getCell(`A${r}`).value = k.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        ws.getCell(`A${r}`).font = { bold: true };
        ws.getCell(`B${r}`).value = v;
        if (typeof v === 'number') ws.getCell(`B${r}`).numFmt = '#,##0.00';
        r++;
      }
    }

    // Freeze header
    ws.views = [{ state: 'frozen', ySplit: 3 }];
  }

  const fileName = `${title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60) || 'report'}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  await wb.xlsx.write(res);
  res.end();
}));

router.get('/features', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const stats = getUsageStats();
  const statsMap = new Map(stats.map(s => [s.featureId, s]));

  const features = AI_FEATURES.map(f => ({
    id: f.id,
    kind: f.kind,
    module: f.module,
    title: f.title,
    description: f.description,
    parameters: f.parameters || [],
    examplePrompt: f.examplePrompt || null,
    preferredProvider: f.preferredProvider || null,
    usage: statsMap.get(f.id) || { invocations: 0, errors: 0, lastInvokedAt: null, lastErrorMessage: null },
  }));

  // Counts by kind for the dashboard
  const counts = {
    total: features.length,
    chatTools: getFeaturesByKind('CHAT_TOOL').length,
    docClassifiers: getFeaturesByKind('DOC_CLASSIFIER').length,
    docExtractors: getFeaturesByKind('DOC_EXTRACTOR').length,
    docVerifiers: getFeaturesByKind('DOC_VERIFIER').length,
  };

  // Provider config snapshot
  const providers = {
    gemini: !!process.env.GEMINI_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
    // openclaw removed 2026-04-21
  };

  res.json({ counts, providers, features });
}));

export default router;
