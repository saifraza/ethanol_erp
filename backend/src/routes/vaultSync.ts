/**
 * Vault Sync API — Exposes vault notes for local Obsidian sync.
 *
 * A local script polls GET /api/vault/pending to get new/updated notes,
 * writes them to ~/Documents/mspil-brain/, then marks them as synced.
 */

import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';

const router = Router();
router.use(authenticate);

// ── GET /pending — Fetch unsynced vault notes ──
router.get('/pending', asyncHandler(async (req: AuthRequest, res: Response) => {
  const notes = await prisma.vaultNote.findMany({
    where: { synced: false },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });

  res.json({ notes, count: notes.length });
}));

// ── POST /mark-synced — Mark notes as synced after local write ──
router.post('/mark-synced', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: 'ids array required' });
    return;
  }

  await prisma.vaultNote.updateMany({
    where: { id: { in: ids } },
    data: { synced: true },
  });

  res.json({ updated: ids.length });
}));

// ── GET /all — List all vault notes ──
router.get('/all', asyncHandler(async (req: AuthRequest, res: Response) => {
  const category = req.query.category as string;
  const where: Record<string, unknown> = {};
  if (category) where.category = category;

  const notes = await prisma.vaultNote.findMany({
    where: where as any,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      sourceType: true,
      vaultPath: true,
      title: true,
      category: true,
      synced: true,
      createdAt: true,
      updatedAt: true,
    },
  
    take: 500,
  });

  res.json({ notes, count: notes.length });
}));

// ── GET /stats — Vault note statistics ──
router.get('/stats', asyncHandler(async (req: AuthRequest, res: Response) => {
  const [total, synced, pending, byCategory] = await Promise.all([
    prisma.vaultNote.count(),
    prisma.vaultNote.count({ where: { synced: true } }),
    prisma.vaultNote.count({ where: { synced: false } }),
    prisma.vaultNote.groupBy({
      by: ['category'],
      _count: { id: true },
    }),
  ]);

  res.json({
    total,
    synced,
    pending,
    categories: byCategory.map((c: { category: string; _count: { id: number } }) => ({
      category: c.category,
      count: c._count.id,
    })),
  });
}));

export default router;
