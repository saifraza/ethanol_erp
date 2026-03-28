import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { getGSTINDetails } from '../services/eInvoice';

const router = Router();

router.use(authenticate as any);

// GET /gstin-lookup/:gstin — Lookup GSTIN via Saral GSP and return transporter-ready details
router.get('/gstin-lookup/:gstin', asyncHandler(async (req: AuthRequest, res: Response) => {
    const { gstin } = req.params;
    if (!gstin || gstin.length !== 15) {
      res.status(400).json({ error: 'GSTIN must be exactly 15 characters' });
      return;
    }

    const result = await getGSTINDetails(gstin);
    if (result.success) {
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
        state: stateMap[stateCode] || `State ${stateCode}`,
        stateCode,
        pincode: result.pincode,
        status: result.status,
        pan: gstin.substring(2, 12),
      });
    } else {
      res.status(400).json({ success: false, error: result.error || 'GSTIN lookup failed' });
    }
}));

// GET / — list active transporters
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
    const transporters = await prisma.transporter.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      take: 500,
    });
    res.json({ transporters });
}));

// POST / — create transporter
router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
    const b = req.body;
    const vehicleCount = parseInt(b.vehicleCount) || 0;

    const transporter = await prisma.transporter.create({
      data: {
        name: b.name || '',
        contactPerson: b.contactPerson || '',
        phone: b.phone || '',
        email: b.email || '',
        gstin: b.gstin ? b.gstin.toUpperCase() : '',
        pan: b.pan ? b.pan.toUpperCase() : '',
        address: b.address || '',
        vehicleCount,
        isActive: true,
      }
    });
    res.status(201).json(transporter);
}));

// PUT /:id — update transporter
router.put('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
    const b = req.body;
    const vehicleCount = parseInt(b.vehicleCount) || 0;

    const transporter = await prisma.transporter.update({
      where: { id: req.params.id },
      data: {
        name: b.name,
        contactPerson: b.contactPerson,
        phone: b.phone,
        email: b.email || '',
        gstin: b.gstin ? b.gstin.toUpperCase() : '',
        pan: b.pan ? b.pan.toUpperCase() : '',
        address: b.address || '',
        vehicleCount,
      }
    });
    res.json(transporter);
}));

// DELETE /:id — soft delete (set isActive: false)
router.delete('/:id', authorize('ADMIN') as any, asyncHandler(async (req: AuthRequest, res: Response) => {
    await prisma.transporter.update({
      where: { id: req.params.id },
      data: { isActive: false }
    });
    res.json({ ok: true });
}));

export default router;
