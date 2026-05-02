/**
 * Factory farmer lookup — read-only proxy to cloud Farmer master.
 *
 * Used by GateEntry.tsx: when the operator types a farmer phone,
 * we look up the master record so the rest of the form (name, village,
 * aadhaar, maan number) auto-fills. Phone is the dedup key — same phone
 * next trip rolls into the existing ledger.
 *
 * Reads via cloudPrisma (Railway PostgreSQL) — works as long as the
 * factory has internet. Returns 404 if no match (caller treats as new
 * farmer and lets the spotInbound handler create the record).
 */
import { Router, Request, Response } from 'express';
import { getCloudPrisma } from '../cloudPrisma';

const router = Router();

const cleanPhone = (p?: string | null) =>
  (p || '').replace(/\D/g, '').slice(-10);

/**
 * Cloud-status ping — returns { online: bool } based on a real-time count
 * query against the cloud Farmer table. Used by GateEntry to gate "new farmer"
 * creation: we refuse to register a new farmer offline because the dedup logic
 * (phone is the primary key) breaks if multiple offline operators all type the
 * same name with different spellings. 1500ms timeout — fast UX, fast failure.
 */
router.get('/cloud-status', async (_req: Request, res: Response) => {
  const cloudPrisma = getCloudPrisma();
  if (!cloudPrisma) {
    res.json({ online: false, reason: 'CLOUD_DATABASE_URL not configured' });
    return;
  }
  try {
    const ping = cloudPrisma.farmer.count({ where: { id: '00000000-0000-0000-0000-000000000000' } });
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500));
    await Promise.race([ping, timeout]);
    res.json({ online: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown';
    res.json({ online: false, reason });
  }
});

/**
 * List farmers — used by GateEntry to populate the Farmer Name dropdown.
 * Returns active farmers ordered by name. Capped at 500 (one factory site
 * realistically tops out at a few hundred regular farmers).
 */
router.get('/list', async (_req: Request, res: Response) => {
  try {
    const cloudPrisma = getCloudPrisma();
    if (!cloudPrisma) {
      res.status(503).json({ error: 'Cloud DB not configured' });
      return;
    }
    const farmers = await cloudPrisma.farmer.findMany({
      where: { isActive: true },
      take: 500,
      orderBy: { name: 'asc' },
      select: {
        id: true, code: true, name: true,
        phone: true, aadhaar: true, maanNumber: true,
        village: true, tehsil: true, district: true, state: true, pincode: true,
        rawMaterialTypes: true,
      },
    });
    res.json({ farmers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[farmers/list] failed:', msg);
    res.status(502).json({ error: 'Cloud DB unreachable', detail: msg });
  }
});

router.get('/lookup', async (req: Request, res: Response) => {
  try {
    const phoneRaw = (req.query.phone as string) || '';
    const aadhaarRaw = (req.query.aadhaar as string) || '';
    const phone = cleanPhone(phoneRaw);
    const aadhaar = (aadhaarRaw || '').replace(/\D/g, '').slice(-12);

    if (!phone && !aadhaar) {
      res.status(400).json({ error: 'phone or aadhaar required' });
      return;
    }

    const cloudPrisma = getCloudPrisma();
    if (!cloudPrisma) {
      res.status(503).json({ error: 'Cloud DB not configured (CLOUD_DATABASE_URL missing)' });
      return;
    }

    let farmer = null;
    if (phone && phone.length === 10) {
      farmer = await cloudPrisma.farmer.findFirst({
        where: { phone, isActive: true },
        select: {
          id: true, code: true, name: true,
          phone: true, aadhaar: true, maanNumber: true,
          village: true, tehsil: true, district: true, state: true, pincode: true,
          rawMaterialTypes: true, kycStatus: true,
        },
      });
    }
    if (!farmer && aadhaar && aadhaar.length === 12) {
      farmer = await cloudPrisma.farmer.findFirst({
        where: { aadhaar, isActive: true },
        select: {
          id: true, code: true, name: true,
          phone: true, aadhaar: true, maanNumber: true,
          village: true, tehsil: true, district: true, state: true, pincode: true,
          rawMaterialTypes: true, kycStatus: true,
        },
      });
    }

    if (!farmer) {
      res.status(404).json({ found: false });
      return;
    }

    res.json({ found: true, farmer });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[farmers/lookup] failed:', msg);
    res.status(502).json({ error: 'Cloud DB unreachable', detail: msg });
  }
});

export default router;
