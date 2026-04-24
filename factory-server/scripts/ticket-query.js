#!/usr/bin/env node
// Companion script for scripts/ticket-lookup.js — runs ON factory.
// Queries factory local DB for a weighment + correction log by ticketNo.
// Prints a single JSON blob to stdout.
//
// Usage:  node scripts/ticket-query.js <ticketNo>

const ticketNo = parseInt(process.argv[2], 10);
if (!ticketNo) {
  console.error('Usage: node scripts/ticket-query.js <ticketNo>');
  process.exit(1);
}

const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const weighments = await p.weighment.findMany({
    where: { ticketNo },
    orderBy: { createdAt: 'asc' },
  });
  const corrections = await p.weighmentCorrectionLog.findMany({
    where: { ticketNo },
    orderBy: { appliedAt: 'asc' },
  });
  process.stdout.write(JSON.stringify({ weighments, corrections }));
  await p.$disconnect();
})().catch((e) => {
  process.stderr.write(e.message);
  process.exit(1);
});
