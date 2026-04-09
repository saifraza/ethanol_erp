import { Router } from 'express';
import configRoutes from './config';
import fiscalYearRoutes from './fiscalYear';
import invoiceSeriesRoutes from './invoiceSeries';
import hsnRoutes from './hsn';
import tdsSectionRoutes from './tdsSection';
import tcsSectionRoutes from './tcsSection';
import auditRoutes from './audit';
import taxRulesRoutes from './taxRules';
import seedRoutes from './seed';

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

export default router;
