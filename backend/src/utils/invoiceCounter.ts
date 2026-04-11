/**
 * Custom invoice number generator using AppConfig as counter store.
 * Series: INV/ETH/001, INV/DDGS/001, etc.
 * Must be called inside a prisma.$transaction to prevent duplicates.
 */

type InvoiceSeries = 'ETH' | 'DDGS' | 'LFO' | 'HFO' | 'RS' | 'ENA' | 'SUG' | 'SCRAP';

const COUNTER_PREFIX = 'counter:INV/';

/**
 * Get next invoice number, atomically incrementing the counter.
 * Uses a single PostgreSQL INSERT ... ON CONFLICT DO UPDATE RETURNING,
 * which is atomic at the DB level — safe under concurrent transactions.
 * Can be called with tx or prisma client; both work.
 * Returns formatted string like "INV/ETH/001"
 */
export async function nextInvoiceNo(tx: any, series: InvoiceSeries): Promise<string> {
  const key = `${COUNTER_PREFIX}${series}`;

  // Atomic increment: single statement, PostgreSQL guarantees serialization
  // on the conflict target (the "key" primary key).
  const rows = await tx.$queryRaw<Array<{ value: string }>>`
    INSERT INTO "AppConfig" ("key", "value", "updatedAt")
    VALUES (${key}, '1', NOW())
    ON CONFLICT ("key") DO UPDATE
      SET "value" = (COALESCE(NULLIF("AppConfig"."value", '')::int, 0) + 1)::text,
          "updatedAt" = NOW()
    RETURNING "value"
  `;
  const counter = parseInt(rows[0]?.value || '1', 10);

  return `INV/${series}/${String(counter).padStart(3, '0')}`;
}

/**
 * Get current counter value without incrementing
 */
export async function currentCounter(prisma: any, series: InvoiceSeries): Promise<number> {
  const key = `${COUNTER_PREFIX}${series}`;
  const config = await prisma.appConfig.findUnique({ where: { key } });
  return config ? parseInt(config.value, 10) : 0;
}

/**
 * Determine invoice series from contract type and product.
 * - Ethanol (any contract type) → ETH
 * - DDGS (any deal type, incl. job work) → DDGS — series MSPIL/DDGS/NNN
 * - Sugar → SUG
 * - Falls back to ETH for unknown.
 */
export function getInvoiceSeries(contractType?: string, productName?: string): InvoiceSeries {
  const p = (productName || '').toUpperCase();
  if (p.includes('DDGS') || p.includes('DISTILLERS') || p.includes('DRIED GRAIN') || p.includes('WET GRAIN')) return 'DDGS';
  if (p.includes('SUGAR')) return 'SUG';
  if (p.includes('LFO')) return 'LFO';
  if (p.includes('HFO')) return 'HFO';
  if (p.includes('RECTIFIED')) return 'RS';
  if (p.includes('ENA')) return 'ENA';
  return 'ETH';
}
