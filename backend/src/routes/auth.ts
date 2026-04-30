import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma';
import { config } from '../config';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';

const router = Router();

router.post('/register', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user || !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
    res.status(403).json({ error: 'Only administrators can create new users' });
    return;
  }

  const { password, name } = req.body;
  if (!password || !name || password.length < 6) {
    res.status(400).json({ error: 'Name and password (min 6 chars) are required' });
    return;
  }

  const email = req.body.email || `${name.toLowerCase().replace(/\s+/g, '.')}@distillery.local`;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(400).json({ error: 'Name already registered' });
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, password: hash, name, role: 'OPERATOR' },
  });

  res.status(201).json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role, allowedModules: user.allowedModules },
  });
}));

router.post('/login', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { username, password } = req.body;

  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { name: { equals: username, mode: 'insensitive' } },
        { email: { equals: username, mode: 'insensitive' } },
      ],
    },
    include: { company: { select: { id: true, code: true, name: true, shortName: true } } },
  });
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
    { id: user.id, email: user.email, role: user.role, name: user.name, allowedModules: user.allowedModules, paymentRole: user.paymentRole, companyId: user.companyId, companyCode: user.company?.code || 'MSPIL' },
    config.jwtSecret,
    { expiresIn: '7d' }
  );

  res.json({
    token,
    user: {
      id: user.id, email: user.email, name: user.name, role: user.role,
      allowedModules: user.allowedModules, paymentRole: user.paymentRole,
      companyId: user.companyId, companyCode: user.company?.code || 'MSPIL',
      companyName: user.company?.shortName || user.company?.name || 'MSPIL',
    },
  });
}));

router.get('/me', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'No user' });
    return;
  }
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, email: true, name: true, role: true, allowedModules: true, paymentRole: true, isActive: true, createdAt: true, companyId: true, company: { select: { id: true, code: true, name: true, shortName: true } } },
  });
  res.json({ ...user, companyCode: user?.company?.code || 'MSPIL', companyName: user?.company?.shortName || user?.company?.name || 'MSPIL' });
}));

export default router;
