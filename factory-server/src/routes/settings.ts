import { Router, Response } from 'express';
import prisma from '../prisma';
import { asyncHandler, requireAuth, requireRole, AuthRequest } from '../middleware';
import { invalidateRuleCache, verifyOverridePin, logOverride } from '../services/ruleEngine';

const router = Router();

// Default rules to seed on first access
const DEFAULT_RULES = [
  {
    key: 'MIN_WEIGHT_INTERVAL_MINUTES',
    label: 'Minimum time between two weights',
    description: 'Minimum minutes that must pass between gross and tare weighment for the same truck',
    value: '10',
    valueType: 'number',
    category: 'WEIGHMENT',
    enabled: true,
    minValue: '1',
    maxValue: '120',
  },
  {
    key: 'DUPLICATE_WEIGHT_WINDOW_MINUTES',
    label: 'Block duplicate weights — look-back window (minutes)',
    description: 'Master switch for frozen-digitizer guard. When ON: reject a weighment if the weight exactly matches a recent weighment on the same WB PC within this many minutes. Catches the frozen-digitizer bug where the operator forgot to press ESC.',
    value: '30',
    valueType: 'number',
    category: 'WEIGHMENT',
    enabled: true,
    minValue: '1',
    maxValue: '480',
  },
  {
    key: 'DUPLICATE_WEIGHT_LOOKBACK',
    label: 'Duplicate weight — how many previous weighments to compare',
    description: 'Number of recent weighments on the same WB PC to compare against. 3 catches a chain of stuck readings.',
    value: '3',
    valueType: 'number',
    category: 'WEIGHMENT',
    enabled: true,
    minValue: '1',
    maxValue: '20',
  },
  {
    key: 'DUPLICATE_WEIGHT_TOLERANCE_KG',
    label: 'Duplicate weight — tolerance (kg)',
    description: '0 = reject only on exact match. Raise to treat near-identical values as duplicates (noise-insensitive scales).',
    value: '0',
    valueType: 'number',
    category: 'WEIGHMENT',
    enabled: true,
    minValue: '0',
    maxValue: '500',
  },
  {
    key: 'ADMIN_OVERRIDE_PIN',
    label: 'Admin Override PIN',
    description: 'PIN required to override rule violations at the weighbridge',
    value: '1234',
    valueType: 'string',
    category: 'GENERAL',
    enabled: true,
  },
];

/** Seed default rules if they don't exist. */
async function seedDefaults(): Promise<void> {
  for (const rule of DEFAULT_RULES) {
    await prisma.businessRule.upsert({
      where: { key: rule.key },
      create: rule,
      update: {}, // Don't overwrite if already exists
    });
  }
}

// GET /api/settings/rules — list all rules
router.get('/rules', requireAuth, asyncHandler(async (_req: AuthRequest, res: Response) => {
  await seedDefaults();
  const rules = await prisma.businessRule.findMany({
    orderBy: [{ category: 'asc' }, { key: 'asc' }],
  });
  res.json(rules);
}));

// GET /api/settings/rules/:key — get single rule
router.get('/rules/:key', requireAuth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const rule = await prisma.businessRule.findUnique({
    where: { key: req.params.key as string },
  });
  if (!rule) {
    res.status(404).json({ error: 'Rule not found' });
    return;
  }
  res.json(rule);
}));

// PUT /api/settings/rules/:key — update rule (admin only)
router.put('/rules/:key', requireAuth, requireRole('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { value, enabled } = req.body;
  const existing = await prisma.businessRule.findUnique({
    where: { key: req.params.key as string },
  });
  if (!existing) {
    res.status(404).json({ error: 'Rule not found' });
    return;
  }

  // Validate number type
  if (existing.valueType === 'number' && value !== undefined) {
    const num = parseFloat(value);
    if (isNaN(num)) {
      res.status(400).json({ error: 'Value must be a number' });
      return;
    }
    if (existing.minValue && num < parseFloat(existing.minValue)) {
      res.status(400).json({ error: `Value must be at least ${existing.minValue}` });
      return;
    }
    if (existing.maxValue && num > parseFloat(existing.maxValue)) {
      res.status(400).json({ error: `Value must be at most ${existing.maxValue}` });
      return;
    }
  }

  const updated = await prisma.businessRule.update({
    where: { key: req.params.key as string },
    data: {
      ...(value !== undefined ? { value: String(value) } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
      updatedBy: req.user?.name || req.user?.username || 'admin',
    },
  });

  invalidateRuleCache();
  res.json(updated);
}));

// POST /api/settings/verify-pin — verify admin override PIN
router.post('/verify-pin', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { pin } = req.body;
  if (!pin) {
    res.status(400).json({ error: 'PIN required' });
    return;
  }
  const valid = await verifyOverridePin(pin);
  res.json({ valid });
}));

// GET /api/settings/override-log — view override audit trail (admin only)
router.get('/override-log', requireAuth, requireRole('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const take = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const logs = await prisma.ruleOverrideLog.findMany({
    take,
    orderBy: { createdAt: 'desc' },
  });
  res.json(logs);
}));

export default router;
