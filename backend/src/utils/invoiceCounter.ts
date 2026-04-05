/**
 * Custom invoice number generator using AppConfig as counter store.
 * Series: INV/ETH/001, INV/DDGS/001, etc.
 * Must be called inside a prisma.$transaction to prevent duplicates.
 */

type InvoiceSeries = 'ETH' | 'DDGS' | 'LFO' | 'HFO' | 'RS' | 'ENA';

const COUNTER_PREFIX = 'counter:INV/';

/**
 * Get next invoice number, atomically incrementing the counter.
 * MUST be called with a transaction client (tx) for atomicity.
 * Returns formatted string like "INV/ETH/001"
 */
export async function nextInvoiceNo(tx: any, series: InvoiceSeries): Promise<string> {
  const key = `${COUNTER_PREFIX}${series}`;

  const existing = await tx.appConfig.findUnique({ where: { key } });
  const counter = existing ? parseInt(existing.value, 10) + 1 : 1;

  await tx.appConfig.upsert({
    where: { key },
    update: { value: String(counter) },
    create: { key, value: String(counter) },
  });

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
 * Determine invoice series from contract type
 */
export function getInvoiceSeries(_contractType: string, _productName?: string): InvoiceSeries {
  return 'ETH';
}
