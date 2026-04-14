# Code Templates — Copy-Paste Patterns

## New Backend Route
```typescript
import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { NotFoundError } from '../shared/errors';
import { z } from 'zod';
import prisma from '../config/prisma';

const router = Router();

const createSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().positive(),
});

// GET list — always paginated, always select
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const take = Math.min(parseInt(req.query.limit as string) || 50, 500);
  const skip = parseInt(req.query.offset as string) || 0;
  const items = await prisma.myModel.findMany({
    take, skip,
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, status: true, createdAt: true },
  });
  res.json(items);
}));

// POST — always validated
router.post('/', validate(createSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const item = await prisma.myModel.create({ data: req.body });
  res.status(201).json(item);
}));

// GET by ID
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const item = await prisma.myModel.findUnique({ where: { id: req.params.id } });
  if (!item) throw new NotFoundError('Item', req.params.id);
  res.json(item);
}));

export default router;
```

**After creating:** register in `backend/src/app.ts` with `app.use('/api/...', router)`

## New Frontend Page (SAP Tier 2)

See `.claude/skills/sap-design-tokens.md` for the exact Tailwind classes.

```typescript
import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface MyItem {
  id: string;
  name: string;
  status: string;
  amount: number;
}

export default function MyPage() {
  const [data, setData] = useState<MyItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get<MyItem[]>('/my-endpoint');
      setData(res.data);
    } catch (err) {
      console.error('Failed to fetch:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fmtCurrency = (n: number) =>
    n === 0 ? '--' : '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2 });

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-xs text-slate-400 uppercase tracking-widest">Loading...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar: bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 */}
        {/* KPI Strip: grid border-x border-b border-slate-300 -mx-3 md:-mx-6 */}
        {/* Table: -mx-3 md:-mx-6 border-x border-b border-slate-300 */}
      </div>
    </div>
  );
}
```

**After creating:** add lazy-loaded Route in `frontend/src/App.tsx`

## IST Timezone Pattern
```typescript
function nowIST(): Date {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}
const ist = nowIST();
const hours = ist.getUTCHours();    // IST hours
const minutes = ist.getUTCMinutes(); // IST minutes
```
**NEVER** use `toLocaleTimeString()` or `toLocaleDateString()` on server.
