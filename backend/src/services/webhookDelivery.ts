/**
 * Webhook Delivery Service — Cloud → Factory Server
 *
 * Pushes events (PO changes, lab results, vendor/material updates)
 * from cloud ERP to the factory server via signed HTTP POST.
 *
 * HMAC-SHA256 signature ensures factory can verify authenticity.
 * Exponential backoff retries up to 5 attempts before marking DEAD.
 */

import crypto from 'crypto';
import prisma from '../config/prisma';

const FACTORY_WEBHOOK_URL = process.env.FACTORY_WEBHOOK_URL || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'mspil-webhook-2026';
const QUEUE_INTERVAL_MS = 10_000; // 10 seconds
const DELIVERY_TIMEOUT_MS = 10_000; // 10 seconds
const MAX_ATTEMPTS = 5;

// Backoff delays in ms: attempt 1→2: 30s, 2→3: 2min, 3→4: 10min, 4→5: 1hr
const BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000];

let processorInterval: NodeJS.Timeout | null = null;

/**
 * Enqueue a webhook event for delivery to the factory server.
 * If FACTORY_WEBHOOK_URL is not configured, silently skips.
 */
export async function enqueueEvent(event: string, payload: object): Promise<string | null> {
  if (!FACTORY_WEBHOOK_URL) return null;

  const row = await prisma.webhookEvent.create({
    data: {
      event,
      payload: payload as any,
      targetUrl: FACTORY_WEBHOOK_URL,
      status: 'PENDING',
      attempts: 0,
      nextRetry: new Date(),
    },
  });

  return row.id;
}

interface WebhookEventRow {
  id: string;
  event: string;
  payload: unknown;
  targetUrl: string;
  status: string;
  attempts: number;
  lastError: string | null;
  nextRetry: Date;
  deliveredAt: Date | null;
  createdAt: Date;
}

/**
 * Deliver a single webhook event via HTTP POST with HMAC signature.
 */
async function deliverEvent(evt: WebhookEventRow): Promise<void> {
  const bodyString = JSON.stringify({
    id: evt.id,
    event: evt.event,
    payload: evt.payload,
    createdAt: evt.createdAt.toISOString(),
  });

  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET).update(bodyString).digest('hex');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

  try {
    const response = await fetch(evt.targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${hmac}`,
        'X-Webhook-Event': evt.event,
        'X-Webhook-Id': evt.id,
      },
      body: bodyString,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.ok) {
      await prisma.webhookEvent.update({
        where: { id: evt.id },
        data: {
          status: 'DELIVERED',
          deliveredAt: new Date(),
          attempts: evt.attempts + 1,
        },
      });
    } else {
      const errText = await response.text().catch(() => 'no body');
      await markFailed(evt, `HTTP ${response.status}: ${errText.slice(0, 200)}`);
    }
  } catch (err: unknown) {
    clearTimeout(timeout);
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(evt, message.slice(0, 500));
  }
}

/**
 * Mark an event as FAILED with backoff, or DEAD after max attempts.
 */
async function markFailed(evt: WebhookEventRow, errorMsg: string): Promise<void> {
  const nextAttempt = evt.attempts + 1;

  if (nextAttempt >= MAX_ATTEMPTS) {
    await prisma.webhookEvent.update({
      where: { id: evt.id },
      data: {
        status: 'DEAD',
        attempts: nextAttempt,
        lastError: errorMsg,
      },
    });
    return;
  }

  const backoffMs = BACKOFF_MS[Math.min(nextAttempt - 1, BACKOFF_MS.length - 1)];
  const nextRetry = new Date(Date.now() + backoffMs);

  await prisma.webhookEvent.update({
    where: { id: evt.id },
    data: {
      status: 'FAILED',
      attempts: nextAttempt,
      lastError: errorMsg,
      nextRetry,
    },
  });
}

/**
 * Process the delivery queue: pick up PENDING/FAILED events due for retry.
 */
async function processQueue(): Promise<void> {
  try {
    const events = await prisma.webhookEvent.findMany({
      where: {
        status: { in: ['PENDING', 'FAILED'] },
        nextRetry: { lte: new Date() },
      },
      orderBy: { nextRetry: 'asc' },
      take: 10,
    });

    for (const evt of events) {
      await deliverEvent(evt);
    }

    if (events.length > 0) {
      const delivered = events.filter(e => e.status === 'PENDING').length;
      console.log(`[Webhook] Processed ${events.length} events`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Webhook] Queue processing error:', message);
  }
}

/**
 * Start the background webhook processor.
 * Only runs if FACTORY_WEBHOOK_URL is configured.
 */
export function startWebhookProcessor(): void {
  if (!FACTORY_WEBHOOK_URL) {
    console.log('[Webhook] FACTORY_WEBHOOK_URL not set — delivery disabled');
    return;
  }

  if (processorInterval) return;

  console.log(`[Webhook] Processor started — delivering to ${FACTORY_WEBHOOK_URL}`);
  processorInterval = setInterval(processQueue, QUEUE_INTERVAL_MS);
  // Run once immediately
  processQueue();
}

/**
 * Get webhook delivery statistics.
 */
export async function getWebhookStats(): Promise<{
  pending: number;
  delivered: number;
  failed: number;
  dead: number;
  lastDelivery: Date | null;
  configured: boolean;
}> {
  const [pending, delivered, failed, dead, lastDelivered] = await Promise.all([
    prisma.webhookEvent.count({ where: { status: 'PENDING' } }),
    prisma.webhookEvent.count({ where: { status: 'DELIVERED' } }),
    prisma.webhookEvent.count({ where: { status: 'FAILED' } }),
    prisma.webhookEvent.count({ where: { status: 'DEAD' } }),
    prisma.webhookEvent.findFirst({
      where: { status: 'DELIVERED' },
      orderBy: { deliveredAt: 'desc' },
      select: { deliveredAt: true },
    }),
  ]);

  return {
    pending,
    delivered,
    failed,
    dead,
    lastDelivery: lastDelivered?.deliveredAt ?? null,
    configured: !!FACTORY_WEBHOOK_URL,
  };
}
