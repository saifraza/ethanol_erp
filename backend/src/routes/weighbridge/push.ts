import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../shared/middleware';
import {
  checkWBKey,
  weighmentSchema,
  buildContext,
  checkWbDuplicate,
  WeighmentInput,
  PushContext,
  PushHandler,
  PushResultEntry,
} from './shared';
import { runPrePhase } from './pre-phase';
import { handlePoInbound } from './handlers/poInbound';
import { handleSpotInbound } from './handlers/spotInbound';
import { handleTraderInbound } from './handlers/traderInbound';
import { handleEthanolOutbound } from './handlers/ethanolOutbound';
import { handleDDGSOutbound } from './handlers/ddgsOutbound';
import { handleNonEthanolOutbound } from './handlers/nonEthanolOutbound';
import { handleFallbackInbound } from './handlers/fallbackInbound';

/**
 * Detect which handler should process this COMPLETE weighment.
 *
 * Order matches the original /push if/else chain:
 *   1. Outbound → ethanol vs non-ethanol
 *   2. Inbound + PO/JOB_WORK with po_id
 *   3. Inbound + SPOT
 *   4. Inbound + TRADER with supplier_id
 *   5. Inbound fallback (no PO, no SPOT, no TRADER)
 *
 * Note: fuel uses the SAME PO handler — fuel-specific behavior is inside
 * handlePoInbound (skips GrainTruck creation, fuel lab fail rejection).
 */
function detectHandler(w: WeighmentInput, ctx: PushContext): PushHandler {
  // Outbound first (simpler — just direction-based)
  if (w.direction === 'OUT') {
    const hasValidGatePassId = w.cloud_gate_pass_id && /^[0-9a-f-]{36}$/i.test(w.cloud_gate_pass_id);
    const lower = (w.material || '').toLowerCase();
    const isEthanol = lower.includes('ethanol') || !!hasValidGatePassId;
    if (isEthanol) return handleEthanolOutbound;

    // DDGS family includes both dried (DDGS) and wet (WDGS) variants
    const isDDGS = w.material_category === 'DDGS' ||
      lower.includes('ddgs') || lower.includes('wdgs') ||
      lower.includes('distillers') || lower.includes('dried grain') ||
      lower.includes('wet grain') || lower.includes('wet distillers');
    if (isDDGS) return handleDDGSOutbound;

    return handleNonEthanolOutbound;
  }

  // Inbound — order matches original behavior
  const hasPoWork = w.po_id && (ctx.purchaseType === 'PO' || ctx.purchaseType === 'JOB_WORK');
  if (hasPoWork) return handlePoInbound;

  if (ctx.purchaseType === 'SPOT') return handleSpotInbound;

  const hasTraderWork = ctx.purchaseType === 'TRADER' && w.supplier_id;
  if (hasTraderWork) return handleTraderInbound;

  return handleFallbackInbound;
}

export function registerPushRoutes(router: Router): void {
  router.post('/push', asyncHandler(async (req: Request, res: Response) => {
    if (!checkWBKey(req, res)) return;

    const { weighments } = req.body;
    if (!Array.isArray(weighments) || weighments.length === 0) {
      return res.status(400).json({ error: 'No weighments provided' });
    }

    const ids: string[] = [];
    const results: PushResultEntry[] = [];

    // SERIAL loop — sequential DB state matters (trader monthly PO, dedup)
    for (const raw of weighments) {
      let w: WeighmentInput;
      try {
        w = weighmentSchema.parse(raw);
      } catch (e) {
        console.error(`[WB-PUSH] Schema parse error for ${raw?.id}:`, e instanceof Error ? e.message : e);
        continue;
      }

      try {
        const ctx = buildContext(w);

        // ── PRE-PHASE: gate entries + dupGrain merge ──
        const prePhase = await runPrePhase(w, ctx);
        if (prePhase) {
          ids.push(...prePhase.ids);
          results.push(...prePhase.results);
          if (prePhase.shortCircuit) continue;
        }

        // Skip incomplete weighments (no weights to process)
        if (w.status !== 'COMPLETE' || !w.weight_net || !w.weight_gross || !w.weight_tare) {
          continue;
        }

        // ── DEDUP: check if this WB id was already processed in another table ──
        const dup = await checkWbDuplicate(w);
        if (dup) {
          ids.push(dup.id);
          continue;
        }

        // ── DISPATCH: route to type-specific handler ──
        const handler = detectHandler(w, ctx);
        const outcome = await handler(w, ctx);
        ids.push(...outcome.ids);
        results.push(...outcome.results);
      } catch (err) {
        // Per-item error isolation — one bad record doesn't fail the whole batch
        console.error(`[WB-PUSH] Error processing weighment ${w.id} (${w.vehicle_no}):`, err instanceof Error ? err.message : err);
      }
    }

    res.json({
      ok: true,
      ids,
      results,
      count: results.length,
      processedWbIds: results.map(r => r.sourceWbId).filter(Boolean),
    });
  }));
}
