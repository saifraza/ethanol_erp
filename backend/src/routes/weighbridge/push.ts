import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../shared/middleware';
import prisma from '../../config/prisma';
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
import { broadcastToGroup } from '../../services/messagingGateway';
import { runPrePhase } from './pre-phase';
import { handlePoInbound } from './handlers/poInbound';
import { handleSpotInbound } from './handlers/spotInbound';
import { handleTraderInbound } from './handlers/traderInbound';
import { handleEthanolOutbound } from './handlers/ethanolOutbound';
import { handleDDGSOutbound } from './handlers/ddgsOutbound';
import { handleSugarOutbound } from './handlers/sugarOutbound';
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
  // Stage 2: explicit handler override from InventoryItem.handlerKey wins over auto-detect.
  // Set this on the cloud item via /inventory/items UI; factory passes it through on push.
  if (w.handler_key) {
    switch (w.handler_key) {
      case 'ETHANOL_OUTBOUND': return handleEthanolOutbound;
      case 'DDGS_OUTBOUND': return handleDDGSOutbound;
      // case 'SUGAR_OUTBOUND': return handleSugarOutbound; // DISABLED — separate weighbridge
      case 'PO_INBOUND': return handlePoInbound;
      case 'SPOT_INBOUND': return handleSpotInbound;
      // Unknown handlerKey → fall through to auto-detect rather than crash
    }
  }

  // Outbound first (simpler — just direction-based)
  if (w.direction === 'OUT') {
    const hasValidGatePassId = w.cloud_gate_pass_id && /^[0-9a-f-]{36}$/i.test(w.cloud_gate_pass_id);
    const lower = (w.material || '').toLowerCase();
    const isEthanol = lower.includes('ethanol') || !!hasValidGatePassId;
    if (isEthanol) return handleEthanolOutbound;

    // Sugar — DISABLED: sugar will use a separate weighbridge system.
    // Handler and import kept for when sugar WB is ready. If sugar accidentally
    // comes through this WB, it falls to nonEthanolOutbound (safe — no data loss).
    // const isSugar = w.material_category === 'SUGAR' || /sugar/i.test(w.material || '');
    // if (isSugar) return handleSugarOutbound;

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
        const parseErr = e instanceof Error ? e.message : String(e);
        console.error(`[WB-PUSH] Schema parse error for ${raw?.id}:`, parseErr);
        // CRITICAL: ACK the bad record so factory stops retrying forever.
        // If the factory payload is malformed, retrying won't help — we need
        // a human to look at it. Log to PlantIssue and mark processed.
        if (raw?.id) {
          ids.push(raw.id);
          results.push({
            id: raw.id,
            type: 'WB_PUSH_SCHEMA_ERROR',
            refNo: raw?.vehicle_no || '',
            sourceWbId: raw.id,
          });
          setImmediate(async () => {
            try {
              await prisma.plantIssue.create({
                data: {
                  title: `Weighbridge push schema error: ${raw?.vehicle_no || 'unknown'}`,
                  description: `Raw payload id: ${raw?.id}\nVehicle: ${raw?.vehicle_no || 'unknown'}\nParse error: ${parseErr}\n\nRaw payload:\n${JSON.stringify(raw, null, 2)}`,
                  issueType: 'OTHER',
                  severity: 'HIGH',
                  equipment: 'Weighbridge / Cloud Sync',
                  location: 'Cloud ERP',
                  status: 'OPEN',
                  reportedBy: 'system-weighbridge',
                  userId: 'system-weighbridge',
                },
              });
            } catch (logErr) {
              console.error('[WB-PUSH] Failed to persist schema-error to PlantIssue:', logErr);
            }
          });
        }
        continue;
      }

      try {
        const ctx = buildContext(w);

        // ── PRE-PHASE: gate entries + dupGrain merge ──
        const prePhase = await runPrePhase(w, ctx);
        let prePhaseAcked = false;
        if (prePhase) {
          ids.push(...prePhase.ids);
          results.push(...prePhase.results);
          // Pre-phase handled this weighment if it added results that reference w.id
          prePhaseAcked = prePhase.results.some(r => r.sourceWbId === w.id);
          if (prePhase.shortCircuit) continue;
        }

        // Skip incomplete weighments (no weights to process)
        if (w.status !== 'COMPLETE' || !w.weight_net || !w.weight_gross || !w.weight_tare) {
          // ACK so factory stops retrying the same partial snapshot. When the
          // weighment later becomes COMPLETE the factory will push a fresh
          // record with the same localId — the dedup path will then pick it
          // up and route to the correct handler.
          // Skip the marker if pre-phase already acked (e.g. GATE_ENTRY trucks
          // that the pre-phase handler legitimately processed).
          if (!prePhaseAcked) {
            ids.push(w.id);
            results.push({
              id: w.id,
              type: 'WB_PUSH_SKIPPED_INCOMPLETE',
              refNo: w.vehicle_no,
              sourceWbId: w.id,
            });
          }
          continue;
        }

        // ── DEDUP: check if this WB id was already processed in another table ──
        const dup = await checkWbDuplicate(w);
        if (dup) {
          ids.push(dup.id);
          // ACK so factory stops retrying — the row already exists in cloud.
          results.push({
            id: dup.id,
            type: 'WB_PUSH_DEDUP',
            refNo: w.vehicle_no,
            sourceWbId: w.id,
          });
          continue;
        }

        // ── DISPATCH: route to type-specific handler ──
        const handler = detectHandler(w, ctx);
        const outcome = await handler(w, ctx);
        ids.push(...outcome.ids);
        results.push(...outcome.results);

        // ── SAFETY NET: Flag any SKIPPED results as PlantIssue ──
        // Catches ALL silent skips from ALL handlers — never lose a truck again.
        const skippedResults = outcome.results.filter(r => r.type === 'SKIPPED');
        if (skippedResults.length > 0) {
          setImmediate(async () => {
            for (const skip of skippedResults) {
              try {
                await prisma.plantIssue.create({
                  data: {
                    title: `Weighbridge SKIP: ${w.vehicle_no} (${w.direction})`,
                    description: [
                      `Vehicle: ${w.vehicle_no}`,
                      `Direction: ${w.direction}`,
                      `Material: ${w.material || 'N/A'}`,
                      `Category: ${w.material_category || 'N/A'}`,
                      `Purchase type: ${w.purchase_type}`,
                      `PO ID: ${w.po_id || 'none'}`,
                      `Supplier: ${w.supplier_name || w.supplier_id || 'none'}`,
                      `Net weight: ${w.weight_net ? (w.weight_net / 1000).toFixed(2) + ' MT' : 'N/A'}`,
                      `Weighment ID: ${w.id}`,
                      `Ticket #: ${w.ticket_no}`,
                      `Skip reason: ${skip.refNo}`,
                    ].join('\n'),
                    issueType: 'OTHER',
                    severity: 'HIGH',
                    equipment: 'Weighbridge / Cloud Sync',
                    location: 'Cloud ERP',
                    status: 'OPEN',
                    reportedBy: 'system-weighbridge',
                    userId: 'system-weighbridge',
                  },
                });
              } catch (logErr) {
                console.error('[WB-PUSH] Failed to persist SKIP to PlantIssue:', logErr);
              }
            }
          });
        }

        // Fire-and-forget weighbridge notification to Group 2
        const dirEmoji = w.direction === 'IN' ? '🟢' : '🔴';
        const netTon = w.weight_net ? (w.weight_net / 1000).toFixed(2) : '?';
        const wbLines = [
          `${dirEmoji} *${w.direction === 'IN' ? 'Inbound' : 'Outbound'}* — ${w.vehicle_no}`,
          `Material: ${w.material || 'N/A'}`,
          `Gross: ${w.weight_gross} kg | Tare: ${w.weight_tare} kg | *Net: ${netTon} MT*`,
          w.supplier_name ? `Party: ${w.supplier_name}` : '',
          outcome.results[0]?.type ? `Type: ${outcome.results[0].type}` : '',
        ].filter(Boolean).join('\n');

        // Send to Group 2 (weighbridge group) — read chatId from settings
        prisma.settings.findFirst({ select: { telegramGroup2ChatId: true } }).then(s => {
          if (s?.telegramGroup2ChatId) {
            broadcastToGroup(s.telegramGroup2ChatId, wbLines, 'weighbridge').catch(() => {});
          }
        }).catch(() => {});

      } catch (err: unknown) {
        // Per-item error isolation — one bad record doesn't fail the whole batch.
        //
        // CRITICAL: ALWAYS ACK the weighment even on handler error. Without this,
        // syncWorker on the factory side never sees the wbId in processedWbIds and
        // retries the weighment forever — that's the 2026-04-07 incident pattern
        // (4 ethanol trucks, sync attempts 60+, exponential backoff, fuel/grain delayed).
        //
        // The cloud DispatchTruck/Shipment may be left orphaned at GATE_IN — that's
        // a separate cleanup, but the factory queue must drain.
        const errCode = (err as Record<string, unknown>)?.code || 'UNKNOWN';
        const errMeta = (err as Record<string, unknown>)?.meta ? JSON.stringify((err as Record<string, unknown>).meta) : '';
        const errMessage = err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err);
        const errStack = err instanceof Error ? err.stack || '' : '';
        const handlerName = ((err as Record<string, unknown>)?.handlerName as string) || 'unknown';
        console.error(
          `[WB-PUSH] FATAL handler error | vehicle=${w.vehicle_no} | wbId=${w.id} | dir=${w.direction} | mat=${w.material} | code=${errCode} | meta=${errMeta} | message=${errMessage}\nstack=${errStack}`,
        );

        // Persist to PlantIssue so we can read the error from cloud DB next time
        // (no Railway log access needed). Fire-and-forget — we still ack the weighment.
        setImmediate(async () => {
          try {
            await prisma.plantIssue.create({
              data: {
                title: `Weighbridge sync handler error: ${w.vehicle_no} (${w.direction})`,
                description: `Vehicle: ${w.vehicle_no}\nDirection: ${w.direction}\nMaterial: ${w.material}\nCategory: ${w.material_category || 'none'}\nWeighment ID: ${w.id}\nGate Pass ID: ${w.cloud_gate_pass_id || 'none'}\nHandler: ${handlerName}\nPrisma code: ${errCode}\nMeta: ${errMeta}\nMessage: ${errMessage}\n\nStack:\n${errStack}`,
                issueType: 'OTHER',
                severity: 'HIGH',
                equipment: 'Weighbridge / Cloud Sync',
                location: 'Cloud ERP',
                status: 'OPEN',
                reportedBy: 'system-weighbridge',
                userId: 'system-weighbridge',
              },
            });
          } catch (logErr) {
            console.error('[WB-PUSH] Failed to persist error to PlantIssue:', logErr);
          }
        });

        // ACK the weighment so factory stops retrying.
        // The handler couldn't create a normal entity, so we synthesize a marker
        // result with the wbId itself so processedWbIds includes it.
        results.push({
          id: w.id,
          type: 'WB_PUSH_HANDLER_ERROR',
          refNo: w.vehicle_no,
          sourceWbId: w.id,
        });
        ids.push(w.id);
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
