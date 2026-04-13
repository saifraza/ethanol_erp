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

/** Returns Prisma where-clause for company scoping.
 *  Priority: X-Company-Id header (company switcher) > JWT companyId.
 *  SUPER_ADMIN/ADMIN on MSPIL can switch to any company.
 *  Other users are locked to their JWT companyId. */
export function getCompanyFilter(req: AuthRequest): { companyId?: string } {
  const headerCompanyId = req.headers['x-company-id'] as string | undefined;

  // If header present and user is allowed to switch companies
  if (headerCompanyId) {
    const isMspilAdmin = (!req.user?.companyId || req.user.companyCode === 'MSPIL') &&
      (req.user?.role === 'ADMIN' || req.user?.role === 'SUPER_ADMIN');
    // MSPIL admins can switch to any company
    if (isMspilAdmin) return { companyId: headerCompanyId };
    // Non-MSPIL users can only use their own companyId
    if (headerCompanyId === req.user?.companyId) return { companyId: headerCompanyId };
  }

  // Fallback: JWT-based filtering
  const MSPIL_ID = 'b499264a-8c73-4595-ab9b-7dc58f58c4d2';
  const isMspil = !req.user?.companyId || req.user.companyCode === 'MSPIL';
  if (isMspil) {
    // Only ADMIN/SUPER_ADMIN get unscoped access; operators see MSPIL only
    if (req.user?.role === 'ADMIN' || req.user?.role === 'SUPER_ADMIN') return {};
    return { companyId: req.user?.companyId ?? MSPIL_ID };
  }
  return { companyId: req.user!.companyId! };
}

/** Returns the companyId to use when creating new records.
 *  Uses X-Company-Id header if available, otherwise JWT companyId, otherwise null. */
export function getActiveCompanyId(req: AuthRequest): string | null {
  const headerCompanyId = req.headers['x-company-id'] as string | undefined;
  if (headerCompanyId) {
    const isMspilAdmin = (!req.user?.companyId || req.user.companyCode === 'MSPIL') &&
      (req.user?.role === 'ADMIN' || req.user?.role === 'SUPER_ADMIN');
    if (isMspilAdmin) return headerCompanyId;
    if (headerCompanyId === req.user?.companyId) return headerCompanyId;
  }
  return req.user?.companyId || null;
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
