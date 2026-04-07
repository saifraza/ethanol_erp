import prisma from '../config/prisma';

// Indian FY: Apr–Mar. e.g. April 2026 → "2026-27"
function currentFY(): string {
  const d = new Date(Date.now() + 5.5 * 60 * 60 * 1000); // IST
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0=Jan
  return m >= 3 ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`;
}

function nextSeq(prefix: string, lastNo: string | undefined): string {
  const lastSeq = lastNo ? parseInt(lastNo.split('/').pop() || '0', 10) || 0 : 0;
  return `${prefix}${String(lastSeq + 1).padStart(3, '0')}`;
}

export async function nextDDGSContractNo(): Promise<string> {
  const prefix = `DDGS/${currentFY()}/`;
  const last = await prisma.dDGSContract.findFirst({
    where: { contractNo: { startsWith: prefix } },
    orderBy: { contractNo: 'desc' },
    select: { contractNo: true },
  });
  return nextSeq(prefix, last?.contractNo);
}

export async function nextEthanolContractNo(): Promise<string> {
  const prefix = `ETH/${currentFY()}/`;
  const last = await prisma.ethanolContract.findFirst({
    where: { contractNo: { startsWith: prefix } },
    orderBy: { contractNo: 'desc' },
    select: { contractNo: true },
  });
  return nextSeq(prefix, last?.contractNo);
}

export async function nextSugarContractNo(): Promise<string> {
  const prefix = `SUG/${currentFY()}/`;
  const last = await prisma.sugarContract.findFirst({
    where: { contractNo: { startsWith: prefix } },
    orderBy: { contractNo: 'desc' },
    select: { contractNo: true },
  });
  return nextSeq(prefix, last?.contractNo);
}
