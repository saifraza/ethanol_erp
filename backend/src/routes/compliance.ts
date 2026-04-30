import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { NotFoundError } from '../shared/errors';
import { z } from 'zod';
import { lightragQuery, isRagEnabled } from '../services/lightragClient';
import { COMPLIANCE_SEED } from '../data/complianceSeed';

const router = Router();
router.use(authenticate);

// ── Schemas ──────────────────────────────────────────────

const createSchema = z.object({
  category: z.string().min(1),
  subcategory: z.string().optional(),
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  actOrRegulation: z.string().optional(),
  authority: z.string().optional(),
  department: z.string().optional(),
  ownerName: z.string().optional(),
  frequency: z.enum(['ONE_TIME', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL', 'BIENNIAL', 'EVENT_BASED']),
  dueDate: z.string().optional(),
  lastCompletedDate: z.string().optional(),
  leadTimeDays: z.number().int().min(0).optional(),
  status: z.enum(['COMPLIANT', 'NON_COMPLIANT', 'EXPIRING', 'PENDING', 'NOT_APPLICABLE']).optional(),
  riskLevel: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
  penaltyInfo: z.string().optional(),
  notes: z.string().optional(),
});

const updateSchema = createSchema.partial();

const actionSchema = z.object({
  actionType: z.enum(['RENEWED', 'FILED', 'SUBMITTED', 'INSPECTED', 'PAID', 'UPLOADED', 'NOTE', 'STATUS_CHANGE']),
  description: z.string().min(1),
  performedBy: z.string().optional(),
  performedDate: z.string().optional(),
  documentId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const linkDocSchema = z.object({
  documentId: z.string().min(1),
  isFulfilling: z.boolean().optional(),
  notes: z.string().optional(),
});

const askSchema = z.object({
  question: z.string().min(1).max(2000),
});

// ── Dashboard KPIs ───────────────────────────────────────

router.get('/dashboard', asyncHandler(async (req: AuthRequest, res: Response) => {
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [total, byStatus, byCategory, byRisk, expiringSoon, recentActions] = await Promise.all([
    prisma.complianceObligation.count(),
    prisma.complianceObligation.groupBy({ by: ['status'], _count: { id: true } }),
    prisma.complianceObligation.groupBy({ by: ['category'], _count: { id: true } }),
    prisma.complianceObligation.groupBy({ by: ['riskLevel'], _count: { id: true } }),
    prisma.complianceObligation.findMany({
      where: {
        status: { in: ['COMPLIANT', 'PENDING', 'EXPIRING'] },
        dueDate: { gte: now, lte: in30Days },
      },
      select: { id: true, title: true, category: true, dueDate: true, riskLevel: true, status: true },
      orderBy: { dueDate: 'asc' },
      take: 20,
    }),
    prisma.complianceAction.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true, actionType: true, description: true, performedBy: true, performedDate: true,
        obligation: { select: { id: true, title: true, category: true } },
      },
    }),
  ]);

  // Category × status matrix
  const categoryStatus = await prisma.complianceObligation.groupBy({
    by: ['category', 'status'],
    _count: { id: true },
  });

  const statusCounts: Record<string, number> = {};
  byStatus.forEach(s => { statusCounts[s.status] = s._count.id; });

  const categoryCounts: Record<string, number> = {};
  byCategory.forEach(c => { categoryCounts[c.category] = c._count.id; });

  const riskCounts: Record<string, number> = {};
  byRisk.forEach(r => { riskCounts[r.riskLevel] = r._count.id; });

  // Build heatmap: { FACTORY_LABOR: { COMPLIANT: 5, PENDING: 3, ... }, ... }
  const heatmap: Record<string, Record<string, number>> = {};
  categoryStatus.forEach(cs => {
    if (!heatmap[cs.category]) heatmap[cs.category] = {};
    heatmap[cs.category][cs.status] = cs._count.id;
  });

  res.json({
    total,
    statusCounts,
    categoryCounts,
    riskCounts,
    heatmap,
    expiringSoon,
    recentActions,
    compliantPercent: total > 0
      ? Math.round(((statusCounts['COMPLIANT'] || 0) / total) * 100)
      : 0,
  });
}));

// ── Calendar view ────────────────────────────────────────

router.get('/calendar', asyncHandler(async (req: AuthRequest, res: Response) => {
  const months = parseInt(req.query.months as string) || 3;
  const now = new Date();
  const end = new Date(now.getTime() + months * 30 * 24 * 60 * 60 * 1000);

  const obligations = await prisma.complianceObligation.findMany({
    where: {
      dueDate: { gte: now, lte: end },
      status: { not: 'NOT_APPLICABLE' },
    },
    select: {
      id: true, title: true, category: true, dueDate: true,
      riskLevel: true, status: true, frequency: true, department: true,
    },
    orderBy: { dueDate: 'asc' },
    take: 200,
  });

  res.json(obligations);
}));

// ── Gap analysis ─────────────────────────────────────────

router.get('/gaps', asyncHandler(async (req: AuthRequest, res: Response) => {
  const obligations = await prisma.complianceObligation.findMany({
    where: {
      status: { not: 'NOT_APPLICABLE' },
      documents: { none: {} },
    },
    select: {
      id: true, title: true, category: true, riskLevel: true,
      status: true, dueDate: true, authority: true,
    },
    orderBy: [{ riskLevel: 'asc' }, { dueDate: 'asc' }],
    take: 100,
  });

  res.json({ count: obligations.length, obligations });
}));

// ── List obligations ─────────────────────────────────────

router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const take = Math.min(parseInt(req.query.limit as string) || 50, 500);
  const skip = parseInt(req.query.offset as string) || 0;
  const { category, status, riskLevel, department, search, frequency } = req.query;

  const where: Record<string, unknown> = {};
  if (category) where.category = category;
  if (status) where.status = status;
  if (riskLevel) where.riskLevel = riskLevel;
  if (department) where.department = department;
  if (frequency) where.frequency = frequency;
  if (search) {
    where.OR = [
      { title: { contains: search as string, mode: 'insensitive' } },
      { description: { contains: search as string, mode: 'insensitive' } },
      { authority: { contains: search as string, mode: 'insensitive' } },
      { actOrRegulation: { contains: search as string, mode: 'insensitive' } },
    ];
  }

  // Auto-mark overdue obligations BEFORE querying (so results are fresh)
  await prisma.complianceObligation.updateMany({
    where: { status: { in: ['COMPLIANT', 'PENDING', 'EXPIRING'] }, dueDate: { lt: new Date() } },
    data: { status: 'NON_COMPLIANT' },
  }).catch(err => console.error('Failed to mark overdue compliance:', err));

  const [items, total] = await Promise.all([
    prisma.complianceObligation.findMany({
      where: where as any,
      take,
      skip,
      orderBy: [{ riskLevel: 'asc' }, { dueDate: 'asc' }],
      select: {
        id: true, category: true, subcategory: true, title: true,
        actOrRegulation: true, authority: true, department: true, ownerName: true,
        frequency: true, dueDate: true, lastCompletedDate: true, leadTimeDays: true,
        status: true, riskLevel: true, penaltyInfo: true, notes: true,
        createdAt: true, updatedAt: true,
        _count: { select: { documents: true, actions: true } },
      },
    }),
    prisma.complianceObligation.count({ where: where as any }),
  ]);

  res.json({ items, total });
}));

// ── Get single obligation ────────────────────────────────

router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const item = await prisma.complianceObligation.findUnique({
    where: { id: req.params.id },
    include: {
      documents: {
        include: {
          document: {
            select: {
              id: true, title: true, category: true, fileName: true,
              expiryDate: true, status: true, referenceNo: true, issuedBy: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
      actions: {
        orderBy: { performedDate: 'desc' },
        take: 50,
      },
    },
  });
  if (!item) throw new NotFoundError('ComplianceObligation', req.params.id);

  // Fetch VaultNote insights for linked documents (already generated, zero API cost)
  const docIds = item.documents.map(d => d.documentId);
  const vaultNotes = docIds.length > 0 ? await prisma.vaultNote.findMany({
    where: { sourceType: 'CompanyDocument', sourceId: { in: docIds } },
    select: { sourceId: true, summary: true, entities: true, title: true },
    take: 10,
  }) : [];

  // Parse entities JSON and attach to response
  const insights = vaultNotes.map(vn => {
    let parsed: Record<string, unknown> = {};
    try { parsed = vn.entities ? JSON.parse(vn.entities) : {}; } catch { /* ignore */ }
    return {
      documentId: vn.sourceId,
      title: vn.title,
      summary: vn.summary,
      keyDates: parsed.key_dates || [],
      parties: parsed.parties || [],
      keyAmounts: parsed.key_amounts || [],
      obligations: parsed.obligations || [],
    };
  });

  // Fallback: if no VaultNotes but docs are linked and RAG is enabled,
  // do a one-time RAG query and cache result in obligation notes
  if (insights.length === 0 && docIds.length > 0 && isRagEnabled() && !item.notes?.startsWith('[AI]')) {
    setImmediate(async () => {
      try {
        const result = await lightragQuery(
          `Summarize key details about: ${item.title}. Include dates, parties, obligations, and important conditions.`,
          'hybrid'
        );
        if (result.success && result.answer) {
          await prisma.complianceObligation.update({
            where: { id: item.id },
            data: { notes: `[AI] ${result.answer}` },
          });
        }
      } catch { /* ignore */ }
    });
  }

  res.json({ ...item, insights });
}));

// ── Create obligation ────────────────────────────────────

router.post('/', validate(createSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const data: Record<string, unknown> = { ...req.body, createdBy: req.user!.id };
  if (data.dueDate) data.dueDate = new Date(data.dueDate as string);
  if (data.lastCompletedDate) data.lastCompletedDate = new Date(data.lastCompletedDate as string);

  const item = await prisma.complianceObligation.create({ data: data as any });
  res.status(201).json(item);
}));

// ── Update obligation ────────────────────────────────────

router.put('/:id', validate(updateSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.complianceObligation.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new NotFoundError('ComplianceObligation', req.params.id);

  const data: Record<string, unknown> = { ...req.body };
  if (data.dueDate) data.dueDate = new Date(data.dueDate as string);
  if (data.lastCompletedDate) data.lastCompletedDate = new Date(data.lastCompletedDate as string);

  // Wrap status change + update in transaction
  const item = await prisma.$transaction(async (tx) => {
    if (data.status && data.status !== existing.status) {
      await tx.complianceAction.create({
        data: {
          obligationId: req.params.id,
          actionType: 'STATUS_CHANGE',
          description: `Status changed from ${existing.status} to ${data.status}`,
          performedBy: req.user!.id,
          isAutoGenerated: false,
        },
      });
    }
    return tx.complianceObligation.update({
      where: { id: req.params.id },
      data: data as any,
    });
  });
  res.json(item);
}));

// ── Delete (archive) obligation ──────────────────────────

router.delete('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.complianceObligation.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new NotFoundError('ComplianceObligation', req.params.id);

  await prisma.complianceObligation.delete({ where: { id: req.params.id } });
  res.json({ message: 'Deleted' });
}));

// ── Link document to obligation ──────────────────────────

router.post('/:id/documents', validate(linkDocSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const obligation = await prisma.complianceObligation.findUnique({ where: { id: req.params.id } });
  if (!obligation) throw new NotFoundError('ComplianceObligation', req.params.id);

  const doc = await prisma.companyDocument.findUnique({ where: { id: req.body.documentId } });
  if (!doc) throw new NotFoundError('CompanyDocument', req.body.documentId);

  const link = await prisma.complianceDocument.create({
    data: {
      obligationId: req.params.id,
      documentId: req.body.documentId,
      isFulfilling: req.body.isFulfilling ?? true,
      notes: req.body.notes,
    },
  });

  // Log action
  await prisma.complianceAction.create({
    data: {
      obligationId: req.params.id,
      actionType: 'UPLOADED',
      description: `Linked document: ${doc.title}`,
      performedBy: req.user!.id,
      documentId: doc.id,
    },
  });

  // Auto-populate obligation fields from document metadata (only fill empty fields)
  const updates: Record<string, unknown> = {};
  if (!obligation.dueDate && doc.expiryDate) updates.dueDate = doc.expiryDate;
  if (!obligation.department && doc.department) updates.department = doc.department;
  if (Object.keys(updates).length > 0) {
    await prisma.complianceObligation.update({
      where: { id: req.params.id },
      data: updates as any,
    });
  }

  res.status(201).json(link);
}));

// ── Unlink document ──────────────────────────────────────

router.delete('/:id/documents/:docId', asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.complianceDocument.deleteMany({
    where: { obligationId: req.params.id, documentId: req.params.docId },
  });
  res.json({ message: 'Unlinked' });
}));

// ── Log compliance action ────────────────────────────────

router.post('/:id/actions', validate(actionSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const obligation = await prisma.complianceObligation.findUnique({ where: { id: req.params.id } });
  if (!obligation) throw new NotFoundError('ComplianceObligation', req.params.id);

  const data: Record<string, unknown> = {
    ...req.body,
    obligationId: req.params.id,
    performedBy: req.body.performedBy || req.user!.id,
  };
  if (data.performedDate) data.performedDate = new Date(data.performedDate as string);

  const action = await prisma.complianceAction.create({ data: data as any });

  // If action is RENEWED/FILED/SUBMITTED, update obligation + advance dueDate
  if (['RENEWED', 'FILED', 'SUBMITTED', 'PAID'].includes(req.body.actionType)) {
    const now = new Date();
    const updateData: Record<string, unknown> = {
      status: 'COMPLIANT',
      lastCompletedDate: now,
    };

    // Advance dueDate based on frequency
    if (obligation.dueDate) {
      const next = new Date(obligation.dueDate);
      switch (obligation.frequency) {
        case 'MONTHLY': next.setMonth(next.getMonth() + 1); break;
        case 'QUARTERLY': next.setMonth(next.getMonth() + 3); break;
        case 'HALF_YEARLY': next.setMonth(next.getMonth() + 6); break;
        case 'ANNUAL': next.setFullYear(next.getFullYear() + 1); break;
        case 'BIENNIAL': next.setFullYear(next.getFullYear() + 2); break;
        // ONE_TIME and EVENT_BASED — don't advance
      }
      if (next > now) updateData.dueDate = next;
    }

    await prisma.complianceObligation.update({
      where: { id: req.params.id },
      data: updateData as any,
    });
  }

  res.status(201).json(action);
}));

// ── Get action history ───────────────────────────────────

router.get('/:id/actions', asyncHandler(async (req: AuthRequest, res: Response) => {
  const take = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const actions = await prisma.complianceAction.findMany({
    where: { obligationId: req.params.id },
    orderBy: { performedDate: 'desc' },
    take,
  });
  res.json(actions);
}));

// ── Seed default obligations ─────────────────────────────

router.post('/seed', asyncHandler(async (req: AuthRequest, res: Response) => {
  const seedData = COMPLIANCE_SEED.map(item => ({
    ...item,
    status: 'PENDING',
    createdBy: req.user!.id,
  }));

  const result = await prisma.complianceObligation.createMany({
    data: seedData,
    skipDuplicates: true, // Uses @@unique([title, category]) to skip existing
  });

  res.json({ created: result.count, skipped: COMPLIANCE_SEED.length - result.count, total: COMPLIANCE_SEED.length });
}));

// ── RAG: Auto-link documents for an obligation ───────────

router.post('/:id/auto-link', asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!isRagEnabled()) {
    res.status(503).json({ error: 'RAG service not configured' });
    return;
  }

  const obligation = await prisma.complianceObligation.findUnique({ where: { id: req.params.id } });
  if (!obligation) throw new NotFoundError('ComplianceObligation', req.params.id);

  const query = `${obligation.title} ${obligation.actOrRegulation || ''} ${obligation.authority || ''}`.trim();
  const ragResult = await lightragQuery(query, 'hybrid');

  // Extract abbreviations in parentheses like (CTE), (CTO), (EC) + regular keywords
  const abbrMatch = obligation.title.match(/\(([A-Z]{2,})\)/g);
  const abbreviations = abbrMatch ? abbrMatch.map(m => m.replace(/[()]/g, '')) : [];
  const words = obligation.title.split(/[\s—–\-(),]+/).filter(w => w.length > 2);
  const allKeywords = [...new Set([...abbreviations, ...words])].slice(0, 8);

  // Search CompanyDocuments using OR (any keyword match)
  const searchConditions = allKeywords.map(k => ({
    OR: [
      { title: { contains: k, mode: 'insensitive' as const } },
      { description: { contains: k, mode: 'insensitive' as const } },
      { tags: { contains: k, mode: 'insensitive' as const } },
    ],
  }));

  // Also match by compliance category
  const categorySearch = obligation.subcategory
    ? { subcategory: { contains: obligation.subcategory, mode: 'insensitive' as const } }
    : undefined;

  const matchingDocs = await prisma.companyDocument.findMany({
    where: {
      OR: [
        ...searchConditions,
        ...(categorySearch ? [categorySearch] : []),
      ],
    },
    select: { id: true, title: true, category: true, expiryDate: true, status: true, referenceNo: true },
    take: 15,
  });

  // Get already linked doc IDs
  const linkedIds = await prisma.complianceDocument.findMany({
    where: { obligationId: req.params.id },
    select: { documentId: true },
  
    take: 500,
  });
  const linkedSet = new Set(linkedIds.map(l => l.documentId));

  const suggestions = matchingDocs.filter(d => !linkedSet.has(d.id));

  res.json({
    ragAnswer: ragResult.answer || ragResult.error || '',
    suggestedDocuments: suggestions,
  });
}));

// ── RAG: Compliance Q&A ──────────────────────────────────

router.post('/ask', validate(askSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!isRagEnabled()) {
    res.status(503).json({ error: 'RAG service not configured' });
    return;
  }

  const { question } = req.body;

  const result = await lightragQuery(
    `Compliance question for MSPIL (distillery, sugar mill, cogen power plant, listed company): ${question}`,
    'hybrid'
  );

  res.json({ question, answer: result.answer || result.error || 'No answer found.' });
}));

export default router;
