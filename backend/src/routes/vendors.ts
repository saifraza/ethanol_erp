import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
router.use(authenticate as any);

// GET / — list all active vendors, ordered by name
router.get('/', async (req: Request, res: Response) => {
  try {
    const vendors = await prisma.vendor.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    res.json({ vendors });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /:id — single vendor with outstanding balance and PO count
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const vendor = await prisma.vendor.findUnique({
      where: { id: req.params.id },
    });
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

    // Calculate outstanding balance (sum of vendorInvoice.balanceAmount)
    const invoices = await prisma.vendorInvoice.findMany({
      where: { vendorId: req.params.id },
    });
    const outstandingBalance = invoices.reduce((sum, inv) => sum + (inv.balanceAmount || 0), 0);

    // Count total POs
    const poCount = await prisma.purchaseOrder.count({
      where: { vendorId: req.params.id },
    });

    res.json({
      vendor,
      outstandingBalance,
      poCount,
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST / — create vendor
router.post('/', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const vendor = await prisma.vendor.create({
      data: {
        name: b.name,
        tradeName: b.tradeName || null,
        category: b.category || null,
        gstin: b.gstin || null,
        pan: b.pan || null,
        gstState: b.gstState || null,
        gstStateCode: b.gstStateCode || null,
        isRCM: b.isRCM || false,
        isMSME: b.isMSME || false,
        msmeRegNo: b.msmeRegNo || null,
        msmeCategory: b.msmeCategory || null,
        address: b.address || null,
        city: b.city || null,
        state: b.state || null,
        pincode: b.pincode || null,
        contactPerson: b.contactPerson || null,
        phone: b.phone || null,
        email: b.email || null,
        bankName: b.bankName || null,
        bankBranch: b.bankBranch || null,
        bankAccount: b.bankAccount || null,
        bankIfsc: b.bankIfsc || null,
        paymentTerms: b.paymentTerms || null,
        creditLimit: b.creditLimit ? parseFloat(b.creditLimit) : 0,
        creditDays: b.creditDays ? parseInt(b.creditDays) : 0,
        tdsApplicable: b.tdsApplicable || false,
        tdsSection: b.tdsSection || null,
        tdsPercent: b.tdsPercent ? parseFloat(b.tdsPercent) : 0,
        remarks: b.remarks || null,
        isActive: true,
      },
    });
    res.status(201).json(vendor);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /:id — update vendor
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const vendor = await prisma.vendor.update({
      where: { id: req.params.id },
      data: {
        name: b.name !== undefined ? b.name : undefined,
        tradeName: b.tradeName !== undefined ? b.tradeName : undefined,
        category: b.category !== undefined ? b.category : undefined,
        gstin: b.gstin !== undefined ? b.gstin : undefined,
        pan: b.pan !== undefined ? b.pan : undefined,
        gstState: b.gstState !== undefined ? b.gstState : undefined,
        gstStateCode: b.gstStateCode !== undefined ? b.gstStateCode : undefined,
        isRCM: b.isRCM !== undefined ? b.isRCM : undefined,
        isMSME: b.isMSME !== undefined ? b.isMSME : undefined,
        msmeRegNo: b.msmeRegNo !== undefined ? b.msmeRegNo : undefined,
        msmeCategory: b.msmeCategory !== undefined ? b.msmeCategory : undefined,
        address: b.address !== undefined ? b.address : undefined,
        city: b.city !== undefined ? b.city : undefined,
        state: b.state !== undefined ? b.state : undefined,
        pincode: b.pincode !== undefined ? b.pincode : undefined,
        contactPerson: b.contactPerson !== undefined ? b.contactPerson : undefined,
        phone: b.phone !== undefined ? b.phone : undefined,
        email: b.email !== undefined ? b.email : undefined,
        bankName: b.bankName !== undefined ? b.bankName : undefined,
        bankBranch: b.bankBranch !== undefined ? b.bankBranch : undefined,
        bankAccount: b.bankAccount !== undefined ? b.bankAccount : undefined,
        bankIfsc: b.bankIfsc !== undefined ? b.bankIfsc : undefined,
        paymentTerms: b.paymentTerms !== undefined ? b.paymentTerms : undefined,
        creditLimit: b.creditLimit !== undefined ? parseFloat(b.creditLimit) : undefined,
        creditDays: b.creditDays !== undefined ? parseInt(b.creditDays) : undefined,
        tdsApplicable: b.tdsApplicable !== undefined ? b.tdsApplicable : undefined,
        tdsSection: b.tdsSection !== undefined ? b.tdsSection : undefined,
        tdsPercent: b.tdsPercent !== undefined ? parseFloat(b.tdsPercent) : undefined,
        remarks: b.remarks !== undefined ? b.remarks : undefined,
      },
    });
    res.json(vendor);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// DELETE /:id — soft delete (isActive: false)
router.delete('/:id', authorize('ADMIN') as any, async (req: Request, res: Response) => {
  try {
    await prisma.vendor.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /seed — seed default vendors
router.post('/seed', authorize('ADMIN') as any, async (req: Request, res: Response) => {
  try {
    const vendors = await prisma.vendor.createMany({
      data: [
        {
          name: 'Local Maize Trader',
          category: 'RAW_MATERIAL_SUPPLIER',
          paymentTerms: 'NET7',
          creditDays: 7,
          isActive: true,
        },
        {
          name: 'Chemical Supplier',
          category: 'CHEMICAL_SUPPLIER',
          paymentTerms: 'NET15',
          creditDays: 15,
          isActive: true,
        },
      ],
      skipDuplicates: true,
    });
    res.json({ created: vendors.count });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
