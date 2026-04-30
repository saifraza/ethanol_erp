import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';

const router = Router();

router.get('/', authenticate, authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      paymentRole: true,
      allowedModules: true,
      isActive: true,
      createdAt: true,
    },
  
    take: 500,
  });
  res.json(users);
}));

router.post('/', authenticate, authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { password, name, role, allowedModules } = req.body;

  if (!name || !name.trim()) {
    res.status(400).json({ error: 'Name is required' });
    return;
  }

  if (!password || password.length < 4) {
    res.status(400).json({ error: 'Password must be at least 4 characters' });
    return;
  }

  // Auto-generate email from name (DB requires unique email)
  const email = req.body.email || `${name.toLowerCase().replace(/\s+/g, '.')}@distillery.local`;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(400).json({ error: 'User with this name already exists' });
    return;
  }

  // Only SUPER_ADMIN can create SUPER_ADMIN users
  const targetRole = role || 'OPERATOR';
  if (targetRole === 'SUPER_ADMIN' && req.user?.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Only Super Admin can create Super Admin users' });
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      email,
      password: hash,
      name: name.trim(),
      role: targetRole,
      allowedModules: allowedModules || null,
      paymentRole: req.body.paymentRole || null,
    },
  });

  res.status(201).json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    paymentRole: user.paymentRole,
    allowedModules: user.allowedModules,
    isActive: user.isActive,
  });
}));

// PUT /api/users/:id — update role, allowedModules, isActive
router.put('/:id', authenticate, authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  // Prevent ADMIN from editing SUPER_ADMIN users or promoting to SUPER_ADMIN
  const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { role: true } });
  if (target?.role === 'SUPER_ADMIN' && req.user?.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Only Super Admin can edit Super Admin users' });
    return;
  }
  if (req.body.role === 'SUPER_ADMIN' && req.user?.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Only Super Admin can assign Super Admin role' });
    return;
  }

  const data: Record<string, unknown> = {};
  if (req.body.role !== undefined) data.role = req.body.role;
  if (req.body.allowedModules !== undefined) data.allowedModules = req.body.allowedModules || null;
  if (req.body.isActive !== undefined) data.isActive = req.body.isActive;
  if (req.body.name !== undefined) data.name = req.body.name;
  if (req.body.paymentRole !== undefined) data.paymentRole = req.body.paymentRole || null;

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data,
  });
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    paymentRole: user.paymentRole,
    allowedModules: user.allowedModules,
    isActive: user.isActive,
  });
}));

router.patch('/:id/role', authenticate, authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { role } = req.body;
  if (role === 'SUPER_ADMIN' && req.user?.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Only Super Admin can assign Super Admin role' });
    return;
  }
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { role },
  });
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });
}));

router.patch('/:id/deactivate', authenticate, authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { isActive: false },
  });
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    isActive: user.isActive,
  });
}));

// DELETE /api/users/:id
router.delete('/:id', authenticate, authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  // Don't allow deleting yourself
  if (req.params.id === req.user?.id) {
    res.status(400).json({ error: 'Cannot delete yourself' });
    return;
  }
  // Prevent ADMIN from deleting SUPER_ADMIN users
  const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { role: true } });
  if (target?.role === 'SUPER_ADMIN' && req.user?.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Only Super Admin can delete Super Admin users' });
    return;
  }
  await prisma.user.delete({ where: { id: req.params.id } });
  res.json({ success: true });
}));

// PUT /api/users/:id/password — change password
router.put('/:id/password', authenticate, authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { password } = req.body;
  if (!password || password.length < 4) {
    res.status(400).json({ error: 'Password must be at least 4 characters' });
    return;
  }
  const hash = await bcrypt.hash(password, 10);
  await prisma.user.update({ where: { id: req.params.id }, data: { password: hash } });
  res.json({ success: true });
}));

export default router;
