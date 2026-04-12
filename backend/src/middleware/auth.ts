import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    name: string;
    allowedModules: string | null;
    companyId: string | null;
    companyCode: string | null;
  };
}

/**
 * Returns a Prisma `where` filter for company scoping.
 * MSPIL users (default company or null) see all data.
 * Sister concern users see only their company's data.
 */
export function getCompanyFilter(req: AuthRequest): { companyId?: string } {
  if (!req.user?.companyId || req.user.companyCode === 'MSPIL') return {};
  return { companyId: req.user.companyId };
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1] || (req.query.token as string);

  if (!token) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as any;
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }
};

export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    const userRole = req.user.role;
    if (roles.includes(userRole)) { next(); return; }
    // SUPER_ADMIN inherits ADMIN access
    if (userRole === 'SUPER_ADMIN' && roles.includes('ADMIN')) { next(); return; }
    res.status(403).json({ error: 'Insufficient permissions' });
  };
};
