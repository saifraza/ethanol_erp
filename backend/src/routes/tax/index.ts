import { Router, Response } from 'express';
import configRoutes from './config';
import fiscalYearRoutes from './fiscalYear';
import invoiceSeriesRoutes from './invoiceSeries';
import hsnRoutes from './hsn';
import tdsSectionRoutes from './tdsSection';
import tcsSectionRoutes from './tcsSection';
import auditRoutes from './audit';
import taxRulesRoutes from './taxRules';
import seedRoutes from './seed';
import gstr2bReconRoutes from './gstr2bRecon';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { asyncHandler } from '../../shared/middleware';
import { calculateTds } from '../../services/tdsCalculator';

const router = Router();

router.use('/config', configRoutes);
router.use('/fiscal-years', fiscalYearRoutes);
router.use('/invoice-series', invoiceSeriesRoutes);
router.use('/hsn', hsnRoutes);
router.use('/tds-sections', tdsSectionRoutes);
router.use('/tcs-sections', tcsSectionRoutes);
router.use('/audit', auditRoutes);
router.use('/rules', taxRulesRoutes);
router.use('/seed', seedRoutes);
router.use('/gstr2b-recon', gstr2bReconRoutes);

// ── TDS Calculator (live preview for payment screens) ──
router.post('/calculate-tds', authenticate as any, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { vendorId, amount } = req.body;
  if (!vendorId || !amount) {
    res.status(400).json({ error: 'vendorId and amount are required' });
    return;
  }
  const result = await calculateTds(vendorId, parseFloat(amount));
  res.json(result);
}));

export default router;
