import { Router, Response } from 'express';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { runUploadBackup } from '../services/uploadBackupJob';

const router = Router();

/**
 * POST /api/admin/backup-uploads/run-now
 *
 * Manually triggers a one-shot backup of /app/backend/uploads/ → neat-shelf bucket.
 * Used to seed the bucket immediately after first wiring it up — saves waiting
 * until the 2 AM IST scheduled run. Safe to re-run; it skips files already in
 * the bucket.
 *
 * SUPER_ADMIN only. Returns the run summary.
 */
router.post('/run-now', authenticate, authorize('SUPER_ADMIN'), asyncHandler(async (_req: AuthRequest, res: Response) => {
  const summary = await runUploadBackup();
  res.json({ ok: true, summary });
}));

export default router;
