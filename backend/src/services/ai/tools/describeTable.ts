import prisma from '../../../config/prisma';
import type { AIFeature } from '../types';
import { READABLE_TABLES } from './listTables';

export const describeTable: AIFeature = {
  id: 'chat.tool.describe_table',
  kind: 'CHAT_TOOL',
  module: 'meta',
  title: 'Describe DB Table (field list)',
  description: 'Return the field names + types of a table so you know what columns are available before calling query_table. Use after list_tables.',
  parameters: [
    { name: 'table', type: 'string', required: true, description: 'Table name from list_tables (camelCase, e.g. "vendor", "purchaseOrder")' },
  ],
  examplePrompt: 'What fields does the vendor table have?',
  async execute(args) {
    const table = String(args.table || '').trim();
    if (!READABLE_TABLES.includes(table)) {
      return { error: `Table "${table}" is not readable. Call list_tables to see allowed tables.` };
    }
    const model = (prisma as any)[table];
    if (!model || typeof model.findFirst !== 'function') {
      return { error: `Table "${table}" not found in Prisma client.` };
    }
    // Sample first row to infer fields + types
    const sample = await model.findFirst({});
    if (!sample) {
      return { table, sample: null, message: 'Table is empty — no fields to describe yet.' };
    }
    const fields = Object.entries(sample).map(([name, value]) => ({
      field: name,
      type: value === null ? 'null'
        : value instanceof Date ? 'date'
        : Array.isArray(value) ? 'array'
        : typeof value,
      sample_value: value instanceof Date ? value.toISOString() : (typeof value === 'object' ? JSON.stringify(value).slice(0, 60) : String(value).slice(0, 60)),
    }));
    return {
      table,
      field_count: fields.length,
      rows: fields,
    };
  },
};
