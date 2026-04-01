import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../prisma';
import { asyncHandler, requireAuth, requireRole, AuthRequest } from '../middleware';
import { config } from '../config';

const router = Router();

// POST /api/auth/login
router.post('/login', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: 'Username and password required' });
    return;
  }

  const user = await prisma.factoryUser.findUnique({ where: { username } });
  if (!user || !user.isActive) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, name: user.name, role: user.role },
    config.jwtSecret,
    { expiresIn: '30d' }
  );

  res.json({
    token,
    user: { id: user.id, username: user.username, name: user.name, role: user.role },
  });
}));

// GET /api/auth/me
router.get('/me', requireAuth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const user = await prisma.factoryUser.findUnique({
    where: { id: req.user!.id },
    select: { id: true, username: true, name: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) {
    res.status(401).json({ error: 'User not found' });
    return;
  }
  res.json(user);
}));

// POST /api/auth/seed — create default users (one-shot, locked after first run)
// Passwords come from env vars; hardcoded defaults are only for initial setup
router.post('/seed', asyncHandler(async (_req: AuthRequest, res: Response) => {
  // Lock: if any user already exists, refuse to seed
  const existingCount = await prisma.factoryUser.count();
  if (existingCount > 0) {
    res.status(403).json({ error: 'Seed locked — users already exist. Use admin panel to manage users.' });
    return;
  }

  const adminPass = process.env.FACTORY_ADMIN_PASS || 'admin123';
  const gatePass = process.env.FACTORY_GATE_PASS || 'gate123';
  const wbPass = process.env.FACTORY_WB_PASS || 'wb123';
  const users = [
    { username: 'admin', password: adminPass, name: 'Administrator', role: 'ADMIN' },
    { username: 'gate1', password: gatePass, name: 'Gate Entry 1', role: 'GATE_ENTRY' },
    { username: 'wb1', password: wbPass, name: 'Weighbridge 1', role: 'WEIGHBRIDGE' },
  ];

  const created: string[] = [];
  for (const u of users) {
    const hashed = await bcrypt.hash(u.password, 10);
    await prisma.factoryUser.create({
      data: { username: u.username, password: hashed, name: u.name, role: u.role },
    });
    created.push(u.username);
  }

  res.json({ created, message: 'Users seeded. Change passwords immediately.' });
}));

// GET /api/auth/users — list all users (admin only)
router.get('/users', requireAuth, requireRole('ADMIN'), asyncHandler(async (_req: AuthRequest, res: Response) => {
  const users = await prisma.factoryUser.findMany({
    select: { id: true, username: true, name: true, role: true, isActive: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  res.json(users);
}));

// POST /api/auth/users — create user (admin only)
router.post('/users', requireAuth, requireRole('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { username, password, name, role } = req.body;
  if (!username || !password || !name || !role) {
    res.status(400).json({ error: 'All fields required' });
    return;
  }

  const hashed = await bcrypt.hash(password, 10);
  const user = await prisma.factoryUser.create({
    data: { username, password: hashed, name, role },
  });

  res.status(201).json({ id: user.id, username: user.username, name: user.name, role: user.role });
}));

// PUT /api/auth/users/:id — update user (admin only)
router.put('/users/:id', requireAuth, requireRole('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { name, role, isActive } = req.body;
  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (role !== undefined) data.role = role;
  if (isActive !== undefined) data.isActive = isActive;

  const user = await prisma.factoryUser.update({
    where: { id: req.params.id as string },
    data,
    select: { id: true, username: true, name: true, role: true, isActive: true },
  });
  res.json(user);
}));

// PUT /api/auth/users/:id/password — reset password (admin only)
router.put('/users/:id/password', requireAuth, requireRole('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { password } = req.body;
  if (!password || password.length < 3) {
    res.status(400).json({ error: 'Password must be at least 3 characters' });
    return;
  }
  const hashed = await bcrypt.hash(password, 10);
  await prisma.factoryUser.update({
    where: { id: req.params.id as string },
    data: { password: hashed },
  });
  res.json({ ok: true });
}));

export default router;
