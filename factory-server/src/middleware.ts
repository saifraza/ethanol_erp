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

// Role-based access
export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    next();
  };
}
