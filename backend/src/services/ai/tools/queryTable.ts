import prisma from '../../../config/prisma';
import type { AIFeature } from '../types';
import { READABLE_TABLES } from './listTables';

const MAX_ROWS = 500;

export const queryTable: AIFeature = {
  id: 'chat.tool.query_table',
  kind: 'CHAT_TOOL',
  module: 'meta',
  title: 'Query Any DB Table (read-only)',
  description: 'Generic READ-ONLY query into any whitelisted table. Use ONLY if no specific tool matches the question. ALWAYS prefer specific tools (get_truck_arrivals, get_outstanding_payables, etc.) over this.',
  parameters: [
    { name: 'table', type: 'string', required: true, description: 'Table name from list_tables' },
    { name: 'where', type: 'string', required: false, description: 'JSON Prisma where clause as a string. Examples: \'{"status":"PAID"}\' OR \'{"createdAt":{"gte":"2026-04-01","lte":"2026-04-30"}}\'. Date strings will be converted to Date objects automatically.' },
    { name: 'orderBy', type: 'string', required: false, description: 'JSON Prisma orderBy as a string. Example: \'{"createdAt":"desc"}\'' },
    { name: 'limit', type: 'number', required: false, description: `Max rows to return (default 50, max ${MAX_ROWS})` },
    { name: 'count_only', type: 'boolean', required: false, description: 'If true, return only the row count matching where, no rows.' },
  ],
  examplePrompt: 'How many invoices are pending?',
  async execute(args) {
    const table = String(args.table || '').trim();
    if (!READABLE_TABLES.includes(table)) {
      return { error: `Table "${table}" is not readable. Call list_tables first.` };
    }
    const model = (prisma as any)[table];
    if (!model) return { error: `Table "${table}" not found.` };

    let where: any = {};
    if (args.where) {
      try {
        const parsed = typeof args.where === 'string' ? JSON.parse(String(args.where)) : args.where;
        where = convertDateStrings(parsed);
      } catch (err: any) {
        return { error: `Invalid where JSON: ${err.message}` };
      }
    }

    let orderBy: any = undefined;
    if (args.orderBy) {
      try {
        orderBy = typeof args.orderBy === 'string' ? JSON.parse(String(args.orderBy)) : args.orderBy;
      } catch (err: any) {
        return { error: `Invalid orderBy JSON: ${err.message}` };
      }
    }

    if (args.count_only === true) {
      const count = await model.count({ where });
      return { table, where, count };
    }

    const limit = Math.min(MAX_ROWS, Math.max(1, Number(args.limit) || 50));
    const rows = await model.findMany({ where, orderBy, take: limit });

    return {
      table,
      where,
      limit,
      returned_count: rows.length,
      truncated: rows.length === limit,
      rows: rows.map(serializeRow),
    };
  },
};

function convertDateStrings(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(convertDateStrings);
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && !isNaN(Date.parse(v))) {
      out[k] = new Date(v);
    } else if (v && typeof v === 'object') {
      out[k] = convertDateStrings(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function serializeRow(row: any): any {
  if (!row || typeof row !== 'object') return row;
  const out: any = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) out[k] = v.toISOString();
    else if (typeof v === 'bigint') out[k] = Number(v);
    else if (Buffer.isBuffer(v)) out[k] = `<binary ${v.length} bytes>`;
    else out[k] = v;
  }
  return out;
}
