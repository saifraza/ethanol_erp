/**
 * Custom invoice number generator using AppConfig as counter store.
 * Single global series: INV/ETH/001, INV/ETH/002, ...
 * All products (ethanol, DDGS, scrap, etc.) share ONE counter.
 * Must be called inside a prisma.$transaction to prevent duplicates.
 */

const COUNTER_KEY = 'counter:INV/ETH';

/**
 * Get next invoice number, atomically incrementing the counter.
 * Uses a single PostgreSQL INSERT ... ON CONFLICT DO UPDATE RETURNING,
 * which is atomic at the DB level — safe under concurrent transactions.
 * Can be called with tx or prisma client; both work.
 * Returns formatted string like "INV/ETH/053"
 *
 * @param _series — IGNORED. Kept for backward compat; all invoices use ETH counter.
 */
export async function nextInvoiceNo(tx: any, _series?: string): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ value: string }>>`
    INSERT INTO "AppConfig" ("key", "value", "updatedAt")
    VALUES (${COUNTER_KEY}, '1', NOW())
    ON CONFLICT ("key") DO UPDATE
      SET "value" = (COALESCE(NULLIF("AppConfig"."value", '')::int, 0) + 1)::text,
          "updatedAt" = NOW()
    RETURNING "value"
  `;
  const counter = parseInt(rows[0]?.value || '1', 10);

  return `INV/ETH/${String(counter).padStart(3, '0')}`;
}

/**
 * Get current counter value without incrementing
 */
export async function currentCounter(prisma: any, _series?: string): Promise<number> {
  const config = await prisma.appConfig.findUnique({ where: { key: COUNTER_KEY } });
  return config ? parseInt(config.value, 10) : 0;
}

/**
 * @deprecated All invoices use a single global ETH series. Always returns 'ETH'.
 */
export function getInvoiceSeries(_contractType?: string, _productName?: string): 'ETH' {
  return 'ETH';
}
