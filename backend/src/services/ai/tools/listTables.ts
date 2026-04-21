import prisma from '../../../config/prisma';
import type { AIFeature } from '../types';

// Tables exposed to the AI (READ-ONLY). Add a model here only if you've audited
// it for PII risk and want the AI to be able to read it.
const READABLE_TABLES = [
  // Core masters
  'vendor', 'customer', 'product', 'material', 'inventoryItem',
  'employee', 'department', 'designation', 'contractor',
  // Transactional
  'purchaseOrder', 'goodsReceipt', 'gRNLine', 'vendorInvoice', 'vendorPayment',
  'salesOrder', 'invoice', 'payment', 'shipment', 'dispatchTruck',
  'grainTruck', 'weighment', 'ethanolProductEntry', 'fermentationBatch',
  'lABReading', 'lABSample', 'dDGSDispatchTruck',
  // Accounts
  'account', 'journalEntry', 'journalLine', 'bankLoan', 'loanRepayment',
  'cashVoucher', 'bankPayment', 'contractorBill', 'contractorPayment',
  // HR
  'payrollRun', 'payrollLine', 'employeeSalaryComponent', 'salaryComponent',
];

export const listTables: AIFeature = {
  id: 'chat.tool.list_tables',
  kind: 'CHAT_TOOL',
  module: 'meta',
  title: 'List DB Tables (introspection)',
  description: 'Return the catalog of all DB tables the AI can read, with their row counts. Use this FIRST when you need to answer a question and there is no specific tool for the entity. After listing, call describe_table to see fields, then query_table to read data.',
  parameters: [],
  examplePrompt: 'What tables are available?',
  async execute() {
    const out: Array<{ table: string; row_count: number }> = [];
    for (const t of READABLE_TABLES) {
      try {
        const model = (prisma as any)[t];
        if (!model || typeof model.count !== 'function') continue;
        const c = await model.count();
        out.push({ table: t, row_count: c });
      } catch {
        // skip tables that fail (may not exist yet)
      }
    }
    return {
      total_tables: out.length,
      rows: out.sort((a, b) => b.row_count - a.row_count),
      summary: { total_tables: out.length, total_rows: out.reduce((s, t) => s + t.row_count, 0) },
    };
  },
};

export { READABLE_TABLES };
