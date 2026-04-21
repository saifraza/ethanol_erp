import prisma from '../../../config/prisma';
import type { AIFeature } from '../types';

export const getEthanolProduction: AIFeature = {
  id: 'chat.tool.get_ethanol_production',
  kind: 'CHAT_TOOL',
  module: 'production',
  title: 'Get Ethanol Production',
  description: 'Daily ethanol production (BL / AL), total dispatch, average strength, and grain yield over a date range. Use this when the user asks about ethanol output, production volume, KLPD, daily yield, or AL per MT.',
  parameters: [
    { name: 'from', type: 'date', required: true, description: 'YYYY-MM-DD (inclusive)' },
    { name: 'to', type: 'date', required: true, description: 'YYYY-MM-DD (inclusive). Use today if not specified.' },
  ],
  examplePrompt: 'Ethanol production this month',
  async execute(args) {
    const from = new Date(String(args.from));
    const to = new Date(String(args.to) + 'T23:59:59.999Z');

    const entries = await prisma.ethanolProductEntry.findMany({
      where: { date: { gte: from, lte: to } },
      select: {
        date: true,
        productionBL: true, productionAL: true,
        totalDispatch: true, totalStock: true,
        avgStrength: true, klpd: true,
        grainConsumedMT: true, yieldALperMT: true,
      },
      take: 1000,
      orderBy: { date: 'desc' },
    });

    const totalBL = entries.reduce((s, e) => s + e.productionBL, 0);
    const totalAL = entries.reduce((s, e) => s + e.productionAL, 0);
    const totalDispatch = entries.reduce((s, e) => s + e.totalDispatch, 0);
    const totalGrain = entries.reduce((s, e) => s + (e.grainConsumedMT || 0), 0);

    return {
      period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      days: entries.length,
      totalProductionBL: Math.round(totalBL),
      totalProductionAL: Math.round(totalAL),
      totalDispatchBL: Math.round(totalDispatch),
      totalGrainMT: Math.round(totalGrain * 100) / 100,
      avgYieldALperMT: totalGrain > 0 ? Math.round((totalAL / totalGrain) * 100) / 100 : null,
      avgStrength: entries.length > 0 ? Math.round((entries.reduce((s, e) => s + e.avgStrength, 0) / entries.length) * 100) / 100 : null,
      avgKlpd: entries.length > 0 ? Math.round((entries.reduce((s, e) => s + e.klpd, 0) / entries.length) * 100) / 100 : null,
      recentDays: entries.slice(0, 7).map(e => ({
        date: e.date.toISOString().slice(0, 10),
        productionBL: Math.round(e.productionBL),
        productionAL: Math.round(e.productionAL),
        dispatchBL: Math.round(e.totalDispatch),
        klpd: Math.round(e.klpd * 100) / 100,
        yieldALperMT: e.yieldALperMT ? Math.round(e.yieldALperMT * 100) / 100 : null,
      })),
    };
  },
};
