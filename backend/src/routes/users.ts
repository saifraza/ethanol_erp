import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';

const router = Router();

// Email validation regex
const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

router.get('/', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        allowedModules: true,
        isActive: true,
        createdAt: true,
      },
    });
    res.json(users);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { email, password, name, role, allowedModules } = req.body;

    if (!email || !isValidEmail(email)) {
      res.status(400).json({ error: 'Invalid email format' });
      return;
    }

    if (!password || password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(400).json({ error: 'Email already exists' });
      return;
    }

    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        password: hash,
        name,
        role: role || 'OPERATOR',
        allowedModules: allowedModules || null,
      },
    });

    res.status(201).json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      allowedModules: user.allowedModules,
      isActive: user.isActive,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/:id — update role, allowedModules, isActive
router.put('/:id', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const data: any = {};
    if (req.body.role !== undefined) data.role = req.body.role;
    if (req.body.allowedModules !== undefined) data.allowedModules = req.body.allowedModules || null;
    if (req.body.isActive !== undefined) data.isActive = req.body.isActive;
    if (req.body.name !== undefined) data.name = req.body.name;

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data,
    });
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      allowedModules: user.allowedModules,
      isActive: user.isActive,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/role', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { role } = req.body;
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
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/deactivate', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
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
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/users/:id
router.delete('/:id', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    // Don't allow deleting yourself
    if (req.params.id === req.user?.id) {
      res.status(400).json({ error: 'Cannot delete yourself' });
      return;
    }
    await prisma.user.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/:id/password — change password
router.put('/:id/password', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }
    const hash = await bcrypt.hash(password, 10);
    await prisma.user.update({ where: { id: req.params.id }, data: { password: hash } });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
