import { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from './config';

export interface AuthRequest extends Request {
  user?: { id: string; username: string; name: string; role: string };
}

// Wrap async route handlers
export function asyncHandler(fn: (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as AuthRequest, res, next)).catch(next);
  };
}

// API key auth for weighbridge PCs — timing-safe compare
export function requireWbKey(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers['x-wb-key'] as string;
  if (!key || key.length !== config.wbApiKey.length) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }
  const keyBuf = Buffer.from(key, 'utf8');
  const expectedBuf = Buffer.from(config.wbApiKey, 'utf8');
  if (!crypto.timingSafeEqual(keyBuf, expectedBuf)) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }
  next();
}

// JWT auth for frontend users
export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  try {
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, config.jwtSecret) as { id: string; username: string; name: string; role: string };
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Accept either WB API key OR JWT auth (for endpoints called by both PCs and frontend)
export function requireWbKeyOrAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  // Try WB API key first
  const key = req.headers['x-wb-key'] as string;
  if (key && key.length === config.wbApiKey.length) {
    const keyBuf = Buffer.from(key, 'utf8');
    const expectedBuf = Buffer.from(config.wbApiKey, 'utf8');
    if (crypto.timingSafeEqual(keyBuf, expectedBuf)) {
      next();
      return;
    }
  }
  // Fall back to JWT auth
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      const token = header.split(' ')[1];
      const decoded = jwt.verify(token, config.jwtSecret) as { id: string; username: string; name: string; role: string };
      req.user = decoded;
      next();
      return;
    } catch { /* fall through to reject */ }
  }
  res.status(401).json({ error: 'Not authenticated' });
}

// Role-based access
export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    // Support comma-separated multi-roles (e.g. "GATE_ENTRY,GROSS_WB")
    const userRoles = req.user.role.split(',').map(r => r.trim());
    if (userRoles.includes('ADMIN') || userRoles.some(r => roles.includes(r))) {
      next();
      return;
    }
    res.status(403).json({ error: 'Access denied' });
  };
}
