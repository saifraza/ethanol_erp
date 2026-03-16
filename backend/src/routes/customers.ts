import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate as any);

// GET / — list all active customers
router.get('/', async (req: Request, res: Response) => {
  try {
    const customers = await prisma.customer.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    res.json({ customers });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /:id — single customer with summary stats
router.get('/:id', async (req: Request, res: Response) => {
  try {
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
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST / — create customer
router.post('/', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const creditLimit = parseFloat(b.creditLimit) || 0;

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
        defaultTerms: b.defaultTerms || '',
        isActive: true,
        remarks: b.remarks || '',
      }
    });
    res.status(201).json(customer);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /:id — update customer
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const creditLimit = parseFloat(b.creditLimit) || 0;

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
        defaultTerms: b.defaultTerms,
        remarks: b.remarks,
      }
    });
    res.json(customer);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// DELETE /:id — soft delete (set isActive: false)
router.delete('/:id', authorize('ADMIN') as any, async (req: Request, res: Response) => {
  try {
    await prisma.customer.update({
      where: { id: req.params.id },
      data: { isActive: false }
    });
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
