/**
 * Data source adapters for the fill detector.
 *
 * Pulls level/temp/PF time-series from either OPC (preferred) or lab readings
 * (fallback), plus lab timestamps for cross-checks. Returns pure Point[] — the
 * detector itself remains I/O-free.
 */

import prisma from '../../config/prisma';
import type { Point } from './fillDetector';

// Fermenter tag map — mirrors fermenterPhaseDetector.ts (single source later)
const FERMENTER_TAGS: Record<number, { levelTag: string; tempTag: string }> = {
  1: { levelTag: 'LT130201', tempTag: 'TE130201' },
  2: { levelTag: 'LT130202', tempTag: 'TE130202' },
  3: { levelTag: 'LT130301', tempTag: 'TE130301' },
  4: { levelTag: 'LT130302', tempTag: 'TE130302' },
};

// Pre-ferm tank tags
const PF_LEVEL_TAGS = ['LT130101', 'LT130102'];

// ── OPC client (lazy) ────────────────────────────────────────────────────────

let _opc: any = null;
function getOpc(): any | null {
  if (_opc) return _opc;
  if (!process.env.DATABASE_URL_OPC) return null;
  try {
    const { PrismaClient } = require('@prisma/opc-client');
    _opc = new PrismaClient();
    return _opc;
  } catch {
    return null;
  }
}

// ── OPC fetches ──────────────────────────────────────────────────────────────

async function fetchOpcTagSeries(tag: string, from: Date, to: Date): Promise<Point[]> {
  const opc = getOpc();
  if (!opc) return [];

  // For windows >6h, prefer pre-aggregated hourly readings (permanent storage).
  // For recent windows, pull raw readings (24h retention).
  const windowHrs = (to.getTime() - from.getTime()) / 3_600_000;
  const prop = 'IO_VALUE';

  try {
    if (windowHrs > 6) {
      const hourly = await opc.opcHourlyReading.findMany({
        where: { tag, property: prop, hour: { gte: from, lte: to } },
        orderBy: { hour: 'asc' },
        take: 5000,
        select: { hour: true, avg: true },
      });
      return hourly
        .filter((r: any) => r.avg != null)
        .map((r: any) => ({ time: r.hour, value: r.avg }));
    }
    const raw = await opc.opcReading.findMany({
      where: { tag, property: prop, scannedAt: { gte: from, lte: to } },
      orderBy: { scannedAt: 'asc' },
      take: 5000,
      select: { scannedAt: true, value: true },
    });
    return raw.map((r: any) => ({ time: r.scannedAt, value: r.value }));
  } catch {
    return [];
  }
}

export async function fetchFermenterOpc(
  fermenterNo: number,
  from: Date,
  to: Date,
): Promise<{ level: Point[]; temp: Point[]; pfLevel: Point[] }> {
  const tags = FERMENTER_TAGS[fermenterNo];
  if (!tags) return { level: [], temp: [], pfLevel: [] };

  const [level, temp, ...pfParts] = await Promise.all([
    fetchOpcTagSeries(tags.levelTag, from, to),
    fetchOpcTagSeries(tags.tempTag, from, to),
    ...PF_LEVEL_TAGS.map(t => fetchOpcTagSeries(t, from, to)),
  ]);

  // Merge PF tanks: sum or just use the one with more data — we only need "did PF drop" signal
  const pfLevel = pfParts.flat().sort((a, b) => a.time.getTime() - b.time.getTime());
  return { level, temp, pfLevel };
}

// ── Lab fallback / cross-check ───────────────────────────────────────────────

export async function fetchLabLevelSeries(
  fermenterNo: number,
  from: Date,
  to: Date,
): Promise<Point[]> {
  const rows = await prisma.fermentationEntry.findMany({
    where: {
      fermenterNo,
      date: { gte: from, lte: to },
      level: { not: null },
    },
    orderBy: { date: 'asc' },
    take: 1000,
    select: { date: true, level: true },
  });
  return rows
    .filter(r => r.level != null)
    .map(r => ({ time: r.date, value: r.level as number }));
}

export async function fetchLabTempSeries(
  fermenterNo: number,
  from: Date,
  to: Date,
): Promise<Point[]> {
  const rows = await prisma.fermentationEntry.findMany({
    where: {
      fermenterNo,
      date: { gte: from, lte: to },
      temp: { not: null },
    },
    orderBy: { date: 'asc' },
    take: 1000,
    select: { date: true, temp: true },
  });
  return rows
    .filter(r => r.temp != null)
    .map(r => ({ time: r.date, value: r.temp as number }));
}

export async function fetchLabReadingTimes(
  fermenterNo: number,
  from: Date,
  to: Date,
): Promise<Date[]> {
  const rows = await prisma.fermentationEntry.findMany({
    where: { fermenterNo, date: { gte: from, lte: to } },
    orderBy: { date: 'asc' },
    take: 1000,
    select: { date: true },
  });
  return rows.map(r => r.date);
}

// ── Unified fetch: prefer OPC, fall back to lab ──────────────────────────────

export interface FermenterSeries {
  fermenterNo: number;
  from: Date;
  to: Date;
  level: Point[];
  temp: Point[];
  pfLevel: Point[];
  labTimes: Date[];
  source: 'OPC' | 'LAB' | 'HYBRID';
}

export async function fetchFermenterSeries(
  fermenterNo: number,
  from: Date,
  to: Date,
): Promise<FermenterSeries> {
  const [opc, labLevel, labTemp, labTimes] = await Promise.all([
    fetchFermenterOpc(fermenterNo, from, to),
    fetchLabLevelSeries(fermenterNo, from, to),
    fetchLabTempSeries(fermenterNo, from, to),
    fetchLabReadingTimes(fermenterNo, from, to),
  ]);

  const hasOpcLevel = opc.level.length >= 5;
  const hasOpcTemp = opc.temp.length >= 5;

  // OPC level is primary when dense. Temp is best cross-check; fall back to lab temp when OPC empty.
  const level = hasOpcLevel ? opc.level : labLevel;
  const temp = hasOpcTemp ? opc.temp : labTemp;
  const source: FermenterSeries['source'] =
    hasOpcLevel && hasOpcTemp ? 'OPC' : hasOpcLevel || hasOpcTemp ? 'HYBRID' : 'LAB';

  return {
    fermenterNo,
    from,
    to,
    level,
    temp,
    pfLevel: opc.pfLevel,
    labTimes,
    source,
  };
}
