import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { fireSyncEmployeeToDevices } from '../services/employeeDeviceSync';

const router = Router();
router.use(authenticate);

// GET / — list with filters
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { search, departmentId, designationId, status, employmentType, contractorId, isActive } = req.query;
  const where: any = { ...getCompanyFilter(req) };

  if (isActive !== undefined) where.isActive = isActive === 'true';
  else where.isActive = true;
  if (departmentId) where.departmentId = departmentId;
  if (designationId) where.designationId = designationId;
  if (status) where.status = status;
  if (employmentType) where.employmentType = employmentType;
  if (contractorId) where.contractorId = contractorId;
  if (search) {
    const s = search as string;
    where.OR = [
      { firstName: { contains: s, mode: 'insensitive' } },
      { lastName: { contains: s, mode: 'insensitive' } },
      { empCode: { contains: s, mode: 'insensitive' } },
      { phone: { contains: s } },
      { uan: { contains: s } },
    ];
  }

  const employees = await prisma.employee.findMany({
    where,
    orderBy: { empNo: 'asc' },
    take: 5000,
    include: {
      designation: { select: { id: true, title: true, grade: true, band: true } },
      department: { select: { id: true, name: true } },
      reportingTo: { select: { id: true, firstName: true, lastName: true, empCode: true } },
      contractor: { select: { id: true, name: true, contractorCode: true } },
    },
  });
  res.json({ employees });
}));

// GET /org-chart — tree structure
router.get('/org-chart', asyncHandler(async (req: AuthRequest, res: Response) => {
  const employees = await prisma.employee.findMany({
    where: { isActive: true, ...getCompanyFilter(req) },
    select: {
      id: true, empCode: true, firstName: true, lastName: true, photo: true,
      designationId: true, departmentId: true, reportingToId: true,
      designation: { select: { title: true, grade: true, level: true } },
      department: { select: { name: true } },
    },
    orderBy: { empNo: 'asc' },
  
    take: 5000,
  });

  // Build tree: find roots (no reportingTo) and recursively attach children
  const byManager: Record<string, typeof employees> = {};
  const roots: typeof employees = [];

  for (const emp of employees) {
    if (!emp.reportingToId) {
      roots.push(emp);
    } else {
      if (!byManager[emp.reportingToId]) byManager[emp.reportingToId] = [];
      byManager[emp.reportingToId].push(emp);
    }
  }

  function buildTree(node: (typeof employees)[0]): any {
    return {
      ...node,
      children: (byManager[node.id] || []).map(buildTree),
    };
  }

  const tree = roots.map(buildTree);
  res.json({ tree, totalEmployees: employees.length });
}));

// GET /:id — single employee
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const employee = await prisma.employee.findUnique({
    where: { id: req.params.id },
    include: {
      designation: true,
      department: true,
      reportingTo: { select: { id: true, firstName: true, lastName: true, empCode: true } },
      contractor: { select: { id: true, name: true, contractorCode: true } },
      salaryComponents: { include: { component: true }, orderBy: { component: { sortOrder: 'asc' } } },
      reportees: { where: { isActive: true }, select: { id: true, firstName: true, lastName: true, empCode: true, designation: { select: { title: true } } } },
    },
  });
  if (!employee) { res.status(404).json({ error: 'Employee not found' }); return; }
  res.json({ employee });
}));

// POST / — create employee
router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  if (!b.firstName?.trim()) { res.status(400).json({ error: 'First name required' }); return; }
  if (!b.dateOfJoining) { res.status(400).json({ error: 'Date of joining required' }); return; }

  // Auto-generate empCode
  const lastEmp = await prisma.employee.findFirst({ orderBy: { empNo: 'desc' } });
  const nextNo = lastEmp ? lastEmp.empNo + 1 : 1;
  const empCode = `MS-${String(nextNo).padStart(3, '0')}`;

  const employee = await prisma.employee.create({
    data: {
      empCode,
      firstName: b.firstName.trim(),
      lastName: b.lastName?.trim() || '',
      fatherName: b.fatherName || null,
      dateOfBirth: b.dateOfBirth ? new Date(b.dateOfBirth) : null,
      gender: b.gender || null,
      bloodGroup: b.bloodGroup || null,
      maritalStatus: b.maritalStatus || null,
      phone: b.phone || null,
      email: b.email || null,
      addressCurrent: b.addressCurrent || null,
      addressPermanent: b.addressPermanent || null,
      emergencyContact: b.emergencyContact || null,
      emergencyPhone: b.emergencyPhone || null,
      aadhaar: b.aadhaar || null,
      pan: b.pan || null,
      passportNo: b.passportNo || null,
      cardNumber: b.cardNumber || null,
      deviceUserId: b.deviceUserId || null,
      uan: b.uan || null,
      pfMemberNo: b.pfMemberNo || null,
      pfJoiningDate: b.pfJoiningDate ? new Date(b.pfJoiningDate) : null,
      previousPfNo: b.previousPfNo || null,
      isInternationalWorker: b.isInternationalWorker || false,
      higherPensionOpt: b.higherPensionOpt || false,
      esicNo: b.esicNo || null,
      pfNomineeName: b.pfNomineeName || null,
      pfNomineeRelation: b.pfNomineeRelation || null,
      pfNomineeDob: b.pfNomineeDob ? new Date(b.pfNomineeDob) : null,
      pfNomineeShare: b.pfNomineeShare ? parseFloat(b.pfNomineeShare) : null,
      bankName: b.bankName || null,
      bankBranch: b.bankBranch || null,
      bankAccount: b.bankAccount || null,
      bankIfsc: b.bankIfsc || null,
      designationId: b.designationId || null,
      departmentId: b.departmentId || null,
      reportingToId: b.reportingToId || null,
      contractorId: b.contractorId || null,
      contractStartDate: b.contractStartDate ? new Date(b.contractStartDate) : null,
      contractEndDate: b.contractEndDate ? new Date(b.contractEndDate) : null,
      contractRefNo: b.contractRefNo || null,
      dailyWageRate: b.dailyWageRate ? parseFloat(b.dailyWageRate) : null,
      dateOfJoining: new Date(b.dateOfJoining),
      confirmationDate: b.confirmationDate ? new Date(b.confirmationDate) : null,
      employmentType: b.employmentType || 'PERMANENT',
      skillCategory: b.skillCategory || null,
      shiftPattern: b.shiftPattern || null,
      workLocation: b.workLocation || 'FACTORY',
      seasonalStatus: b.seasonalStatus || null,
      ctcAnnual: b.ctcAnnual ? parseFloat(b.ctcAnnual) : 0,
      basicMonthly: b.basicMonthly ? parseFloat(b.basicMonthly) : 0,
      epfApplicable: b.epfApplicable !== false,
      epfOnActualBasic: b.epfOnActualBasic || false,
      esiApplicable: b.esiApplicable !== false,
      ptApplicable: b.ptApplicable !== false,
      taxRegime: b.taxRegime || 'NEW',
      declared80C: b.declared80C ? parseFloat(b.declared80C) : 0,
      declared80D: b.declared80D ? parseFloat(b.declared80D) : 0,
      declaredHRA: b.declaredHRA ? parseFloat(b.declaredHRA) : 0,
      declaredOther: b.declaredOther ? parseFloat(b.declaredOther) : 0,
      rentPaidMonthly: b.rentPaidMonthly ? parseFloat(b.rentPaidMonthly) : 0,
      status: b.status || 'ACTIVE',
      remarks: b.remarks || null,
      companyId: getActiveCompanyId(req),
    },
  });
  fireSyncEmployeeToDevices(employee.id, 'UPSERT');
  res.status(201).json({ employee });
}));

// PUT /:id — update
router.put('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const data: any = {};

  // Map all updatable fields
  const stringFields = [
    'firstName', 'lastName', 'fatherName', 'gender', 'bloodGroup', 'maritalStatus',
    'phone', 'email', 'addressCurrent', 'addressPermanent', 'emergencyContact', 'emergencyPhone',
    'aadhaar', 'pan', 'passportNo', 'uan', 'pfMemberNo', 'previousPfNo', 'esicNo',
    'pfNomineeName', 'pfNomineeRelation', 'bankName', 'bankBranch', 'bankAccount', 'bankIfsc',
    'designationId', 'departmentId', 'reportingToId', 'contractorId', 'contractRefNo',
    'employmentType', 'skillCategory', 'shiftPattern', 'workLocation', 'seasonalStatus', 'taxRegime', 'status', 'remarks',
    'deviceUserId', 'cardNumber',
  ];
  for (const f of stringFields) {
    if (b[f] !== undefined) data[f] = b[f] || null;
  }

  const dateFields = ['dateOfBirth', 'pfJoiningDate', 'pfNomineeDob', 'contractStartDate', 'contractEndDate', 'dateOfJoining', 'confirmationDate', 'dateOfLeaving'];
  for (const f of dateFields) {
    if (b[f] !== undefined) data[f] = b[f] ? new Date(b[f]) : null;
  }

  const floatFields = ['pfNomineeShare', 'dailyWageRate', 'ctcAnnual', 'basicMonthly', 'declared80C', 'declared80D', 'declaredHRA', 'declaredOther', 'rentPaidMonthly'];
  for (const f of floatFields) {
    if (b[f] !== undefined) data[f] = b[f] ? parseFloat(b[f]) : 0;
  }

  const boolFields = ['isInternationalWorker', 'higherPensionOpt', 'epfApplicable', 'epfOnActualBasic', 'esiApplicable', 'ptApplicable', 'isActive'];
  for (const f of boolFields) {
    if (b[f] !== undefined) data[f] = b[f];
  }

  const employee = await prisma.employee.update({ where: { id: req.params.id }, data });
  fireSyncEmployeeToDevices(employee.id, 'UPSERT');
  res.json({ employee });
}));

// DELETE /:id — soft delete
router.delete('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.employee.update({ where: { id: req.params.id }, data: { isActive: false, status: 'RELIEVED' } });
  fireSyncEmployeeToDevices(req.params.id, 'DELETE');
  res.json({ ok: true });
}));

export default router;
