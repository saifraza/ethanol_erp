/**
 * UBI H2H Payment File Generator
 *
 * Generates pipe-delimited .txt files in UBI's H2H format.
 * File naming: MSP8760_NEFT_Multiple_<batchNo>_<timestamp>.txt
 *
 * NOTE: Exact column layout should be confirmed against "Format for SFTP.xlsx"
 * from bank. Current format is based on SOP v1.2 + APPA CSV format.
 */

interface PaymentRecord {
  beneficiaryName: string;
  beneficiaryAccount: string;
  beneficiaryIfsc: string;
  amount: number;
  remarks: string;
  email: string;
  mobile: string;
}

interface BatchInfo {
  batchNo: number;
  paymentType: string;  // NEFT or RTGS
  debitAccount: string;
  payerIfsc: string;
}

const CLIENT_CODE = process.env.UBI_CLIENT_CODE || 'MSP8760';

/**
 * Generate payment file content in pipe-delimited format.
 *
 * Format (pipe-delimited):
 * Row 1: HEADER|ClientCode|BatchRef|PaymentType|RecordCount|TotalAmount|Date
 * Row 2+: PaymentType|PayerIFSC|DebitAccount|BenefIFSC|BenefAccount|INR|Amount|Remarks|BenefName|Email|Mobile
 *
 * NOTE: This format is based on SOP + APPA spec. Will be adjusted once
 * "Format for SFTP.xlsx" is obtained from bank.
 */
export function generatePaymentFileContent(batch: BatchInfo, records: PaymentRecord[]): string {
  const lines: string[] = [];
  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const totalAmount = records.reduce((sum, r) => sum + r.amount, 0);

  // Header row
  lines.push([
    'HEADER',
    CLIENT_CODE,
    `BATCH-${batch.batchNo}`,
    batch.paymentType,
    String(records.length),
    totalAmount.toFixed(2),
    dateStr,
  ].join('|'));

  // Payment records
  for (const rec of records) {
    const benefName = sanitize(rec.beneficiaryName, 40);
    const remarks = sanitize(rec.remarks, 140);
    const email = sanitize(rec.email || 'accounts@mspil.in', 80);
    const mobile = (rec.mobile || '').replace(/[^0-9]/g, '').substring(0, 20) || '0000000000';

    lines.push([
      batch.paymentType,
      batch.payerIfsc,
      batch.debitAccount,
      rec.beneficiaryIfsc,
      rec.beneficiaryAccount,
      'INR',
      rec.amount.toFixed(2),
      remarks,
      benefName,
      email,
      mobile,
    ].join('|'));
  }

  return lines.join('\r\n') + '\r\n';
}

/**
 * Generate file name per UBI convention:
 * CLIENTCODE_TEMPLATEID_DEBITTYPE_FILENAME.txt
 */
export function generateFileName(batchNo: number, paymentType: string): string {
  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  const debitType = 'Multiple';
  return `${CLIENT_CODE}_${paymentType}_${debitType}_BATCH${batchNo}_${ts}.txt`;
}

/**
 * Parse ACK response file — extract UTR numbers and success status per record.
 * NOTE: Actual ACK format needs to be confirmed with bank.
 * This is a best-guess parser that handles pipe-delimited and CSV formats.
 */
export function parseAckFile(content: string): Array<{
  beneficiaryAccount: string;
  beneficiaryName: string;
  amount: number;
  utrNumber: string;
  status: string;
}> {
  const results: Array<{
    beneficiaryAccount: string;
    beneficiaryName: string;
    amount: number;
    utrNumber: string;
    status: string;
  }> = [];

  const lines = content.split(/\r?\n/).filter(l => l.trim());
  for (const line of lines) {
    // Skip header row
    if (line.startsWith('HEADER') || line.startsWith('Sr') || line.startsWith('#')) continue;

    const sep = line.includes('|') ? '|' : ',';
    const cols = line.split(sep).map(c => c.trim());

    // Try to extract: we look for account number, amount, UTR
    // Format may vary — this parser attempts to be flexible
    if (cols.length >= 5) {
      results.push({
        beneficiaryAccount: cols[4] || cols[3] || '',
        beneficiaryName: cols[8] || cols[7] || '',
        amount: parseFloat(cols[6] || cols[5] || '0') || 0,
        utrNumber: cols.find(c => /^[A-Z]{4}[0-9]+$/.test(c)) || cols[cols.length - 2] || '',
        status: 'SUCCESS',
      });
    }
  }

  return results;
}

/**
 * Parse NACK response file — extract failure reasons per record.
 */
export function parseNackFile(content: string): Array<{
  beneficiaryAccount: string;
  beneficiaryName: string;
  amount: number;
  failureReason: string;
}> {
  const results: Array<{
    beneficiaryAccount: string;
    beneficiaryName: string;
    amount: number;
    failureReason: string;
  }> = [];

  const lines = content.split(/\r?\n/).filter(l => l.trim());
  for (const line of lines) {
    if (line.startsWith('HEADER') || line.startsWith('Sr') || line.startsWith('#')) continue;

    const sep = line.includes('|') ? '|' : ',';
    const cols = line.split(sep).map(c => c.trim());

    if (cols.length >= 5) {
      results.push({
        beneficiaryAccount: cols[4] || cols[3] || '',
        beneficiaryName: cols[8] || cols[7] || '',
        amount: parseFloat(cols[6] || cols[5] || '0') || 0,
        failureReason: cols[cols.length - 1] || 'Unknown error',
      });
    }
  }

  return results;
}

/** Sanitize string for bank file: remove pipes, limit length */
function sanitize(str: string, maxLen: number): string {
  return (str || '').replace(/[|]/g, ' ').replace(/[\r\n]/g, ' ').substring(0, maxLen).trim();
}
