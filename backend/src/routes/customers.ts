import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize, AuthRequest, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { getGSTINDetails } from '../services/eInvoice';

const router = Router();

router.use(authenticate as any);

// GET / — list all active customers
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
    const customers = await prisma.customer.findMany({
      where: { isActive: true, ...getCompanyFilter(req) },
      orderBy: { name: 'asc' },
      take: 500,
    });
    res.json({ customers });
}));

// GET /gstin-lookup/:gstin — Lookup GSTIN and return customer-ready details
router.get('/gstin-lookup/:gstin', asyncHandler(async (req: AuthRequest, res: Response) => {
    const { gstin } = req.params;
    if (!gstin || gstin.length !== 15) {
      res.status(400).json({ error: 'GSTIN must be exactly 15 characters' });
      return;
    }

    const result = await getGSTINDetails(gstin);
    if (result.success) {
      // Map state code to state name
      const stateMap: Record<string, string> = {
        '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
        '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan',
        '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh',
        '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura',
        '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
        '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
        '26': 'Dadra and Nagar Haveli', '27': 'Maharashtra', '29': 'Karnataka',
        '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu',
        '34': 'Puducherry', '35': 'Andaman and Nicobar', '36': 'Telangana', '37': 'Andhra Pradesh',
        '38': 'Ladakh',
      };
      const stateCode = String(result.state).padStart(2, '0');
      res.json({
        success: true,
        gstin: result.gstin,
        name: result.tradeName || result.legalName,
        legalName: result.legalName,
        tradeName: result.tradeName,
        address: result.address,
        city: result.city,
        state: stateMap[stateCode] || result.state,
        stateCode,
        pincode: result.pincode,
        status: result.status,
      });
    } else {
      res.status(400).json(result);
    }
}));

// GET /check-duplicate — find potential duplicate customers by GSTIN, PAN, phone, or name
// MUST be before /:id so Express doesn't match "check-duplicate" as an id param
router.get('/check-duplicate', asyncHandler(async (req: AuthRequest, res: Response) => {
  const gstNo = (req.query.gstNo as string || '').trim().toUpperCase();
  const panNo = (req.query.panNo as string || '').trim().toUpperCase();
  const phone = (req.query.phone as string || '').trim();
  const name = (req.query.name as string || '').trim();
  const excludeId = req.query.excludeId as string | undefined;

  if (!gstNo && !panNo && !phone && !name) {
    res.json({ duplicates: [] });
    return;
  }

  const conditions: any[] = [];
  if (gstNo && gstNo.length >= 10) {
    conditions.push({ gstNo: { equals: gstNo, mode: 'insensitive' } });
  }
  if (panNo && panNo.length >= 10) {
    conditions.push({ panNo: { equals: panNo, mode: 'insensitive' } });
  }
  if (phone && phone.length >= 8) {
    conditions.push({ phone: { contains: phone } });
  }
  if (name && name.length >= 3) {
    conditions.push({ name: { contains: name, mode: 'insensitive' } });
  }

  if (conditions.length === 0) {
    res.json({ duplicates: [] });
    return;
  }

  const where: any = { OR: conditions, isActive: true };
  if (excludeId) where.NOT = { id: excludeId };

  const matches = await prisma.customer.findMany({
    where,
    select: {
      id: true, name: true, shortName: true, gstNo: true, panNo: true,
      phone: true, city: true,
    },
    take: 10,
  });

  const duplicates = matches.map(m => {
    const reasons: string[] = [];
    if (gstNo && m.gstNo?.toUpperCase() === gstNo) reasons.push('GSTIN');
    if (panNo && m.panNo?.toUpperCase() === panNo) reasons.push('PAN');
    if (phone && m.phone?.includes(phone)) reasons.push('Phone');
    if (name && m.name.toLowerCase().includes(name.toLowerCase())) reasons.push('Name');
    return { ...m, matchReasons: reasons };
  });

  res.json({ duplicates });
}));

// GET /:id — single customer with summary stats
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id },
    });

    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    // Get outstanding amount (sum of invoice.balanceAmount)
    const invoices = await prisma.invoice.findMany({
      where: { customerId: req.params.id },
      select: { balanceAmount: true },
    });
    const outstandingAmount = invoices.reduce((sum, inv) => sum + inv.balanceAmount, 0);

    // Get total orders (count of salesOrders)
    const totalOrders = await prisma.salesOrder.count({
      where: { customerId: req.params.id },
    });

    res.json({ customer, outstandingAmount, totalOrders });
}));

// POST / — create customer
router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
    const b = req.body;
    const creditLimit = parseFloat(b.creditLimit) || 0;
    const cautionDeposit = parseFloat(b.cautionDeposit) || 0;

    const customer = await prisma.customer.create({
      data: {
        name: b.name || '',
        shortName: b.shortName || '',
        address: b.address || '',
        city: b.city || '',
        state: b.state || '',
        pincode: b.pincode || '',
        gstNo: b.gstNo || '',
        panNo: b.panNo || '',
        contactPerson: b.contactPerson || '',
        phone: b.phone || '',
        email: b.email || '',
        creditLimit,
        cautionDeposit,
        defaultTerms: b.defaultTerms || '',
        isActive: true,
        remarks: b.remarks || '',
        companyId: getActiveCompanyId(req),
      }
    });
    res.status(201).json(customer);
}));

// PUT /:id — update customer
router.put('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
    const b = req.body;
    const creditLimit = parseFloat(b.creditLimit) || 0;
    const cautionDeposit = parseFloat(b.cautionDeposit) || 0;

    const customer = await prisma.customer.update({
      where: { id: req.params.id },
      data: {
        name: b.name,
        shortName: b.shortName,
        address: b.address,
        city: b.city,
        state: b.state,
        pincode: b.pincode,
        gstNo: b.gstNo,
        panNo: b.panNo,
        contactPerson: b.contactPerson,
        phone: b.phone,
        email: b.email,
        creditLimit,
        cautionDeposit,
        defaultTerms: b.defaultTerms,
        remarks: b.remarks,
      }
    });
    res.json(customer);
}));

// DELETE /:id — soft delete (set isActive: false), SUPER_ADMIN only, with reference check
router.delete('/:id', authorize('SUPER_ADMIN') as any, asyncHandler(async (req: AuthRequest, res: Response) => {
    const { checkCustomerReferences } = await import('../utils/referenceCheck');
    const check = await checkCustomerReferences(req.params.id);
    if (!check.canDelete) { res.status(409).json({ error: check.message }); return; }
    await prisma.customer.update({
      where: { id: req.params.id },
      data: { isActive: false }
    });
    res.json({ ok: true });
}));

export default router;
