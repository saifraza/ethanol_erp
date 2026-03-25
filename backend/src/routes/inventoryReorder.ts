import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { NotFoundError } from '../shared/errors';
import { z } from 'zod';
import prisma from '../config/prisma';

const router = Router();

// ─── Schemas ────────────────────────────────────────

const upsertRuleSchema = z.object({
  itemId: z.string().min(1),
  reorderPoint: z.number().min(0),
  reorderQty: z.number().positive(),
  maxStock: z.number().positive().optional(),
  safetyStock: z.number().min(0).default(0),
  leadTimeDays: z.number().int().min(0).default(7),
  autoCreate: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

// ─── GET /rules — all reorder rules with item details and current stock ───

router.get('/rules', asyncHandler(async (req: AuthRequest, res: Response) => {
  const take = Math.min(parseInt(req.query.limit as string) || 50, 500);
  const skip = parseInt(req.query.offset as string) || 0;

  const rules = await prisma.reorderRule.findMany({
    take,
    skip,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      itemId: true,
      reorderPoint: true,
      reorderQty: true,
      maxStock: true,
      safetyStock: true,
      leadTimeDays: true,
      autoCreate: true,
      isActive: true,
      lastTriggered: true,
      item: {
        select: {
          id: true,
          name: true,
          code: true,
          category: true,
          unit: true,
          currentStock: true,
          avgCost: true,
        },
      },
    },
  });

  const enriched = rules.map((rule) => ({
    ...rule,
    isBelowReorder: rule.item.currentStock <= rule.reorderPoint,
    isBelowSafety: rule.item.currentStock <= rule.safetyStock,
  }));

  res.json(enriched);
}));

// ─── GET /alerts — items below reorder point ───

router.get('/alerts', asyncHandler(async (req: AuthRequest, res: Response) => {
  const rules = await prisma.reorderRule.findMany({
    where: { isActive: true },
    take: 200,
    select: {
      id: true,
      reorderPoint: true,
      reorderQty: true,
      safetyStock: true,
      leadTimeDays: true,
      autoCreate: true,
      lastTriggered: true,
      item: {
        select: {
          id: true,
          name: true,
          code: true,
          category: true,
          unit: true,
          currentStock: true,
          avgCost: true,
          supplier: true,
        },
      },
    },
  });

  const alerts = rules
    .filter((rule) => rule.item.currentStock <= rule.reorderPoint)
    .map((rule) => ({
      ...rule,
      shortfall: rule.reorderPoint - rule.item.currentStock,
      isCritical: rule.item.currentStock <= rule.safetyStock,
      suggestedOrderQty: rule.reorderQty,
      estimatedCost: Math.round(rule.reorderQty * rule.item.avgCost * 100) / 100,
    }))
    .sort((a, b) => {
      // Critical items first, then by shortfall descending
      if (a.isCritical !== b.isCritical) return a.isCritical ? -1 : 1;
      return b.shortfall - a.shortfall;
    });

  res.json({
    alerts,
    summary: {
      total: alerts.length,
      critical: alerts.filter((a) => a.isCritical).length,
      totalEstimatedCost: Math.round(
        alerts.reduce((s, a) => s + a.estimatedCost, 0) * 100
      ) / 100,
    },
  });
}));

// ─── POST /rules — create/update reorder rule (upsert by itemId) ───

router.post('/rules', validate(upsertRuleSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { itemId, ...ruleData } = req.body;

  // Verify item exists
  const item = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
  if (!item) throw new NotFoundError('InventoryItem', itemId);

  const rule = await prisma.reorderRule.upsert({
    where: { itemId },
    create: { itemId, ...ruleData },
    update: ruleData,
  });

  res.status(201).json(rule);
}));

// ─── POST /trigger/:itemId — manually trigger reorder → create PurchaseRequisition ───

router.post('/trigger/:itemId', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { itemId } = req.params;
  const userId = req.user!.id;
  const userName = req.user!.name;

  const item = await prisma.inventoryItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      name: true,
      code: true,
      category: true,
      unit: true,
      currentStock: true,
      avgCost: true,
      supplier: true,
      reorderRule: {
        select: { reorderQty: true, leadTimeDays: true },
      },
    },
  });

  if (!item) throw new NotFoundError('InventoryItem', itemId);

  const orderQty = item.reorderRule?.reorderQty ?? item.currentStock; // fallback
  const estimatedCost = Math.round(orderQty * item.avgCost * 100) / 100;

  const requisition = await prisma.purchaseRequisition.create({
    data: {
      title: `Reorder: ${item.name} (${item.code})`,
      itemName: item.name,
      quantity: orderQty,
      unit: item.unit,
      estimatedCost,
      category: item.category === 'SPARE_PART' ? 'SPARE_PART'
        : item.category === 'RAW_MATERIAL' ? 'RAW_MATERIAL'
        : item.category === 'CONSUMABLE' ? 'CONSUMABLE'
        : 'GENERAL',
      urgency: item.currentStock <= 0 ? 'EMERGENCY' : 'SOON',
      justification: `Auto-triggered reorder. Current stock: ${item.currentStock} ${item.unit}`,
      supplier: item.supplier,
      status: 'SUBMITTED',
      requestedBy: userName,
      userId,
    },
  });

  // Update last triggered timestamp
  if (item.reorderRule) {
    await prisma.reorderRule.update({
      where: { itemId },
      data: { lastTriggered: new Date() },
    });
  }

  res.status(201).json(requisition);
}));

export default router;
