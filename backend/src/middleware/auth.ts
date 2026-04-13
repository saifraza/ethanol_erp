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
  // ALL MSPIL users (admin or operator) see all data — don't break running system
  const isMspil = !req.user?.companyId || req.user.companyCode === 'MSPIL';
  if (isMspil) return {};
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
  // Always return a companyId — default to MSPIL so records never have null
  const MSPIL_ID = 'b499264a-8c73-4595-ab9b-7dc58f58c4d2';
  return req.user?.companyId || MSPIL_ID;
}

/** Checks if the requesting user can access a record with the given companyId.
 *  MSPIL users (any role) can access all records.
 *  Non-MSPIL users can only access their own company's records.
 *  Returns true if access is allowed. */
export function canAccessCompany(req: AuthRequest, recordCompanyId: string | null): boolean {
  // No companyId on record = legacy MSPIL data, everyone can access
  if (!recordCompanyId) return true;
  // MSPIL users see everything
  const isMspil = !req.user?.companyId || req.user.companyCode === 'MSPIL';
  if (isMspil) return true;
  // Header override for admin company switching
  const headerCompanyId = req.headers['x-company-id'] as string | undefined;
  if (headerCompanyId) {
    const isMspilAdmin = (!req.user?.companyId || req.user.companyCode === 'MSPIL') &&
      (req.user?.role === 'ADMIN' || req.user?.role === 'SUPER_ADMIN');
    if (isMspilAdmin) return true;
  }
  // Non-MSPIL users: must match their own companyId
  return recordCompanyId === req.user?.companyId;
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
