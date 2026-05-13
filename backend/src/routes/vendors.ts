import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { getGSTINDetails } from '../services/eInvoice';

const router = Router();
router.use(authenticate);

// GET /gstin-lookup/:gstin — Lookup GSTIN via Saral GSP for vendor auto-fill
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

// GET / — list all active vendors, ordered by name
// ?isAgent=true — filter to procurement agents/traders only
// ?isAgent=false — exclude traders (formal vendors only)
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
    const where: Record<string, unknown> = { isActive: true, ...getCompanyFilter(req) };
    if (req.query.isAgent === 'true') where.isAgent = true;
    if (req.query.isAgent === 'false') where.isAgent = false;
    if (req.query.category) {
      const cat = req.query.category as string;
      where.category = cat.includes(',') ? { in: cat.split(',') } : cat;
    }

    const vendors = await prisma.vendor.findMany({
      where,
      orderBy: { name: 'asc' },
      take: 500,
      include: { tdsSectionRef: { select: { id: true, code: true, oldSection: true, nature: true, rateIndividual: true, rateOthers: true } } },
    });
    res.json({ vendors });
}));

// GET /by-item/:itemId — find all vendors who supply a specific item
router.get('/by-item/:itemId', asyncHandler(async (req: AuthRequest, res: Response) => {
    const vendorItems = await prisma.vendorItem.findMany({
      where: { inventoryItemId: req.params.itemId, isActive: true },
      include: { vendor: { select: { id: true, name: true, vendorCode: true } } },
      orderBy: [{ isPreferred: 'desc' }, { rate: 'asc' }],
      take: 50,
    });
    res.json(vendorItems);
}));

// GET /check-duplicate — find potential duplicate vendors by GSTIN, PAN, phone, or name
// MUST be before /:id so Express doesn't match "check-duplicate" as an id param
router.get('/check-duplicate', asyncHandler(async (req: AuthRequest, res: Response) => {
  const gstin = (req.query.gstin as string || '').trim().toUpperCase();
  const pan = (req.query.pan as string || '').trim().toUpperCase();
  const phone = (req.query.phone as string || '').trim();
  const name = (req.query.name as string || '').trim();
  const excludeId = req.query.excludeId as string | undefined;

  if (!gstin && !pan && !phone && !name) {
    res.json({ duplicates: [] });
    return;
  }

  const conditions: any[] = [];
  if (gstin && gstin.length >= 10) {
    conditions.push({ gstin: { equals: gstin, mode: 'insensitive' } });
  }
  if (pan && pan.length >= 10) {
    conditions.push({ pan: { equals: pan, mode: 'insensitive' } });
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

  const matches = await prisma.vendor.findMany({
    where,
    select: {
      id: true, name: true, tradeName: true, gstin: true, pan: true,
      phone: true, city: true, category: true, isAgent: true,
    },
    take: 10,
  });

  const duplicates = matches.map(m => {
    const reasons: string[] = [];
    if (gstin && m.gstin?.toUpperCase() === gstin) reasons.push('GSTIN');
    if (pan && m.pan?.toUpperCase() === pan) reasons.push('PAN');
    if (phone && m.phone?.includes(phone)) reasons.push('Phone');
    if (name && m.name.toLowerCase().includes(name.toLowerCase())) reasons.push('Name');
    return { ...m, matchReasons: reasons };
  });

  res.json({ duplicates });
}));

// GET /:id — single vendor with outstanding balance and PO count
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
    const vendor = await prisma.vendor.findUnique({
      where: { id: req.params.id },
      include: { tdsSectionRef: { select: { id: true, code: true, oldSection: true, nature: true, rateIndividual: true, rateOthers: true } } },
    });
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

    // Calculate outstanding balance (sum of vendorInvoice.balanceAmount)
    const invoices = await prisma.vendorInvoice.findMany({
      where: { vendorId: req.params.id },
    
    take: 500,
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
}));

// GET /:id/ledger — full vendor dossier: POs + GRNs + orphan weighments + invoices + payments
// Cross-company aware: aggregates every Vendor row that shares the same normalized
// name as the seed vendor, so the same business registered separately under each
// sister company (MSPIL / NARSINGHPUR LLP / CHAAPARA LLP) rolls up into one view.
router.get('/:id/ledger', asyncHandler(async (req: AuthRequest, res: Response) => {
    const vendorId = req.params.id;
    const seed = await prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { id: true, name: true, gstin: true, phone: true, email: true, address: true, paymentTerms: true, isMSME: true, msmeCategory: true, tdsApplicable: true, tdsPercent: true, isActive: true, companyId: true },
    });
    if (!seed) return res.status(404).json({ error: 'Vendor not found' });

    // Sibling vendor rows that represent the same business under different sister
    // companies. Match on normalized name (lower + trim). Fall back to seed alone
    // if no siblings (the common case today).
    const siblings = await prisma.$queryRaw<Array<{ id: string; companyId: string | null }>>`
      SELECT id, "companyId" FROM "Vendor"
      WHERE LOWER(TRIM(name)) = LOWER(TRIM(${seed.name}))
    `;
    const vendorIds = siblings.length > 0 ? siblings.map(s => s.id) : [vendorId];

    const grnInclude = {
      id: true, grnNo: true, ticketNo: true, grnDate: true, status: true,
      vehicleNo: true, totalQty: true, totalAmount: true, netWeight: true,
      poId: true, companyId: true,
      po: { select: { poNo: true } },
      company: { select: { code: true, name: true } },
      lines: { select: { description: true, receivedQty: true, unit: true, rate: true, amount: true } },
    } as const;

    const [pos, grns, invoices, payments, orphanWeighments] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where: { vendorId: { in: vendorIds } },
        select: {
          id: true, poNo: true, status: true, poDate: true, dealType: true, grandTotal: true,
          companyId: true,
          company: { select: { code: true, name: true } },
          lines: { select: { description: true, quantity: true, receivedQty: true, unit: true, rate: true } },
        },
        orderBy: { poNo: 'desc' },
        take: 500,
      }),
      prisma.goodsReceipt.findMany({
        where: { vendorId: { in: vendorIds } },
        select: grnInclude,
        orderBy: { grnDate: 'desc' },
        take: 500,
      }),
      prisma.vendorInvoice.findMany({
        where: { vendorId: { in: vendorIds } },
        select: {
          id: true, invoiceNo: true, invoiceDate: true, status: true,
          totalAmount: true, balanceAmount: true,
          companyId: true,
          company: { select: { code: true, name: true } },
          payments: { select: { amount: true, tdsDeducted: true } },
        },
        orderBy: { invoiceDate: 'desc' },
        take: 500,
      }),
      prisma.vendorPayment.findMany({
        where: { vendorId: { in: vendorIds } },
        select: {
          id: true, paymentDate: true, amount: true, mode: true, reference: true,
          paymentStatus: true, tdsDeducted: true, remarks: true,
          companyId: true,
          company: { select: { code: true, name: true } },
        },
        orderBy: { paymentDate: 'desc' },
        take: 500,
      }),
      // Orphan weighments: COMPLETE inbound for this vendor (any sibling) with no
      // matching GRN. Matches by supplierId (any sibling) OR supplierName ILIKE.
      // Cross-company by design — a weighment booked under any sister company
      // counts if the supplier name matches.
      prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT w."ticketNo", w."localId", w."vehicleNo", w."materialName",
               w."firstWeightAt", w."secondWeightAt", w."netWeight",
               w."purchaseType", w."poId", w."labStatus"
        FROM "Weighment" w
        WHERE w.direction = 'INBOUND' AND w.status = 'COMPLETE'
          AND COALESCE(w.cancelled, false) = false
          AND (
            w."supplierId" = ANY(${vendorIds}::text[])
            OR w."supplierName" ILIKE ${'%' + seed.name + '%'}
          )
          AND NOT EXISTS (
            SELECT 1 FROM "GoodsReceipt" g
            WHERE g."vendorId" = ANY(${vendorIds}::text[])
              AND (
                g."ticketNo" = w."ticketNo"
                OR g.remarks ILIKE '%' || w."localId" || '%'
                OR g.remarks ILIKE '%Ticket #' || w."ticketNo" || ' %'
              )
          )
        ORDER BY w."secondWeightAt" DESC NULLS LAST
        LIMIT 200
      `,
    ]);
    const vendor = seed;

    // Totals (computed server-side so the page never has to add money client-side)
    const totalInvoiced = invoices.reduce((s, i) => s + (i.totalAmount || 0), 0);
    const totalPaid = invoices.reduce(
      (s, i) => s + (i.payments || []).reduce((ps, p) => ps + (p.amount || 0) + (p.tdsDeducted || 0), 0),
      0,
    );
    const outstanding = invoices.reduce((s, i) => s + (i.balanceAmount || 0), 0);
    const grnQty = grns.filter(g => g.status === 'CONFIRMED').reduce((s, g) => s + (g.totalQty || 0), 0);
    const grnValue = grns.filter(g => g.status === 'CONFIRMED').reduce((s, g) => s + (g.totalAmount || 0), 0);

    res.json({
      vendor,
      // Sibling vendor ids/companies merged into this ledger. Frontend can show
      // "merged across 3 companies" badge when this is > 1.
      siblings: siblings.map(s => ({ id: s.id, companyId: s.companyId })),
      summary: {
        poCount: pos.length,
        grnCount: grns.length,
        orphanCount: orphanWeighments.length,
        grnTotalQty: Math.round(grnQty * 100) / 100,
        grnTotalValue: Math.round(grnValue * 100) / 100,
        totalInvoiced: Math.round(totalInvoiced * 100) / 100,
        totalPaid: Math.round(totalPaid * 100) / 100,
        outstanding: Math.round(outstanding * 100) / 100,
      },
      pos,
      grns,
      orphanWeighments,
      invoices,
      payments,
    });
}));

// GET /audit/orphan-trucks — system-wide list of every COMPLETE inbound Weighment
// that has no matching GoodsReceipt. Cross-company (no companyFilter applied),
// because the whole point is to surface trucks that fell through the GRN pipeline
// regardless of which sister company they were booked under.
router.get('/audit/orphan-trucks', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const rows = await prisma.$queryRaw<Array<{
    ticketNo: number | null;
    localId: string;
    vehicleNo: string;
    supplierName: string | null;
    supplierId: string | null;
    materialName: string | null;
    firstWeightAt: Date | null;
    secondWeightAt: Date | null;
    netWeight: number | null;
    purchaseType: string | null;
    poId: string | null;
    labStatus: string | null;
    vendorIdByName: string | null;
    vendorName: string | null;
    poNo: number | null;
    poStatus: string | null;
    companyCode: string | null;
    plantIssueId: string | null;
    plantIssueStatus: string | null;
  }>>`
    SELECT
      w."ticketNo", w."localId", w."vehicleNo", w."supplierName", w."supplierId",
      w."materialName", w."firstWeightAt", w."secondWeightAt", w."netWeight",
      w."purchaseType", w."poId", w."labStatus",
      v.id   AS "vendorIdByName",
      v.name AS "vendorName",
      p."poNo"   AS "poNo",
      p.status   AS "poStatus",
      c.code     AS "companyCode",
      pi.id      AS "plantIssueId",
      pi.status  AS "plantIssueStatus"
    FROM "Weighment" w
    LEFT JOIN "PurchaseOrder" p ON p.id = w."poId"
    LEFT JOIN "Company" c       ON c.id = p."companyId"
    LEFT JOIN LATERAL (
      SELECT id, name FROM "Vendor"
      WHERE id = w."supplierId"
         OR LOWER(TRIM(name)) = LOWER(TRIM(w."supplierName"))
      LIMIT 1
    ) v ON TRUE
    LEFT JOIN LATERAL (
      SELECT id, status FROM "PlantIssue"
      WHERE description ILIKE '%' || w."localId" || '%'
         OR description ILIKE '%' || w."vehicleNo" || '%' AND description ILIKE '%Ticket #' || w."ticketNo" || '%'
      ORDER BY "createdAt" DESC
      LIMIT 1
    ) pi ON TRUE
    WHERE w.direction = 'INBOUND' AND w.status = 'COMPLETE'
      AND COALESCE(w.cancelled, false) = false
      AND NOT EXISTS (
        SELECT 1 FROM "GoodsReceipt" g
        WHERE g."ticketNo" = w."ticketNo"
           OR g.remarks ILIKE '%' || w."localId" || '%'
           OR g.remarks ILIKE '%Ticket #' || w."ticketNo" || ' %'
      )
    ORDER BY w."secondWeightAt" DESC NULLS LAST, w."ticketNo" DESC
    LIMIT 1000
  `;

  // Summary by vendor for the dashboard header
  const byVendor = new Map<string, { vendorName: string; count: number; qtyKg: number }>();
  let totalKg = 0;
  for (const r of rows) {
    totalKg += r.netWeight || 0;
    const key = (r.vendorName || r.supplierName || 'UNKNOWN').toUpperCase();
    const prev = byVendor.get(key) || { vendorName: r.vendorName || r.supplierName || 'UNKNOWN', count: 0, qtyKg: 0 };
    prev.count += 1;
    prev.qtyKg += r.netWeight || 0;
    byVendor.set(key, prev);
  }

  res.json({
    summary: {
      totalCount: rows.length,
      totalMt: Math.round((totalKg / 1000) * 100) / 100,
      vendorCount: byVendor.size,
    },
    byVendor: Array.from(byVendor.values()).sort((a, b) => b.qtyKg - a.qtyKg),
    rows,
  });
}));

// POST / — create vendor
router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
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
        tdsSectionId: b.tdsSectionId || null,
        is206ABNonFiler: b.is206ABNonFiler || false,
        lowerDeductionCertNo: b.lowerDeductionCertNo || null,
        lowerDeductionRate: b.lowerDeductionRate ? parseFloat(b.lowerDeductionRate) : null,
        lowerDeductionValidFrom: b.lowerDeductionValidFrom ? new Date(b.lowerDeductionValidFrom) : null,
        lowerDeductionValidTill: b.lowerDeductionValidTill ? new Date(b.lowerDeductionValidTill) : null,
        remarks: b.remarks || null,
        isAgent: b.isAgent || false,
        aadhaarNo: b.aadhaarNo || null,
        rawMaterialType: b.rawMaterialType || null,
        maanNumber: b.maanNumber || null,
        isActive: true,
        companyId: getActiveCompanyId(req),
      },
    });
    res.status(201).json(vendor);
}));

// PUT /:id — update vendor
router.put('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
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
        tdsSectionId: b.tdsSectionId !== undefined ? (b.tdsSectionId || null) : undefined,
        is206ABNonFiler: b.is206ABNonFiler !== undefined ? b.is206ABNonFiler : undefined,
        lowerDeductionCertNo: b.lowerDeductionCertNo !== undefined ? (b.lowerDeductionCertNo || null) : undefined,
        lowerDeductionRate: b.lowerDeductionRate !== undefined ? (b.lowerDeductionRate ? parseFloat(b.lowerDeductionRate) : null) : undefined,
        lowerDeductionValidFrom: b.lowerDeductionValidFrom !== undefined ? (b.lowerDeductionValidFrom ? new Date(b.lowerDeductionValidFrom) : null) : undefined,
        lowerDeductionValidTill: b.lowerDeductionValidTill !== undefined ? (b.lowerDeductionValidTill ? new Date(b.lowerDeductionValidTill) : null) : undefined,
        remarks: b.remarks !== undefined ? b.remarks : undefined,
        isAgent: b.isAgent !== undefined ? b.isAgent : undefined,
        aadhaarNo: b.aadhaarNo !== undefined ? b.aadhaarNo : undefined,
        rawMaterialType: b.rawMaterialType !== undefined ? (b.rawMaterialType || null) : undefined,
        maanNumber: b.maanNumber !== undefined ? (b.maanNumber || null) : undefined,
      },
    });
    res.json(vendor);
}));

// DELETE /:id — soft delete (isActive: false), SUPER_ADMIN only, with reference check
router.delete('/:id', authorize('SUPER_ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
    const { checkVendorReferences } = await import('../utils/referenceCheck');
    const check = await checkVendorReferences(req.params.id);
    if (!check.canDelete) { res.status(409).json({ error: check.message }); return; }
    await prisma.vendor.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json({ ok: true });
}));

// ─── Vendor Items (what items a vendor supplies + rates) ───

// GET /:id/items — list items this vendor supplies
router.get('/:id/items', asyncHandler(async (req: AuthRequest, res: Response) => {
    const items = await prisma.vendorItem.findMany({
      where: { vendorId: req.params.id, isActive: true },
      include: { item: { select: { id: true, name: true, code: true, unit: true, hsnCode: true, gstPercent: true, defaultRate: true } } },
      orderBy: { item: { name: 'asc' } },
      take: 50,
    });
    res.json(items);
}));

// POST /:id/items — add item to vendor's supply list
router.post('/:id/items', asyncHandler(async (req: AuthRequest, res: Response) => {
    const b = req.body;
    const vendorItem = await prisma.vendorItem.upsert({
      where: { vendorId_inventoryItemId: { vendorId: req.params.id, inventoryItemId: b.inventoryItemId } },
      create: {
        vendorId: req.params.id,
        inventoryItemId: b.inventoryItemId,
        rate: parseFloat(b.rate) || 0,
        minOrderQty: b.minOrderQty ? parseFloat(b.minOrderQty) : null,
        leadTimeDays: b.leadTimeDays ? parseInt(b.leadTimeDays) : null,
        remarks: b.remarks || null,
        isPreferred: b.isPreferred || false,
      },
      update: {
        rate: parseFloat(b.rate) || 0,
        minOrderQty: b.minOrderQty ? parseFloat(b.minOrderQty) : null,
        leadTimeDays: b.leadTimeDays ? parseInt(b.leadTimeDays) : null,
        remarks: b.remarks || null,
        isPreferred: b.isPreferred || false,
        isActive: true,
      },
    });
    res.status(201).json(vendorItem);
}));

// DELETE /:id/items/:itemId — remove item from vendor's supply list
router.delete('/:id/items/:itemId', asyncHandler(async (req: AuthRequest, res: Response) => {
    await prisma.vendorItem.updateMany({
      where: { vendorId: req.params.id, inventoryItemId: req.params.itemId },
      data: { isActive: false },
    });
    res.json({ ok: true });
}));

// POST /seed — seed default vendors
router.post('/seed', authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
    const companyId = getActiveCompanyId(req);
    const vendors = await prisma.vendor.createMany({
      data: [
        {
          name: 'Local Maize Trader',
          category: 'RAW_MATERIAL_SUPPLIER',
          paymentTerms: 'NET7',
          creditDays: 7,
          isActive: true,
          companyId,
        },
        {
          name: 'Chemical Supplier',
          category: 'CHEMICAL_SUPPLIER',
          paymentTerms: 'NET15',
          creditDays: 15,
          isActive: true,
          companyId,
        },
      ],
      skipDuplicates: true,
    });
    res.json({ created: vendors.count });
}));

export default router;
