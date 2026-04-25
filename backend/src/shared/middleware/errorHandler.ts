import { Request, Response, NextFunction } from 'express';
import { AppError, ValidationError } from '../errors';

export const errorHandler = (err: Error, req: Request, res: Response, _next: NextFunction): void => {
  if (err instanceof AppError) {
    console.error(`[${err.code}] ${req.method} ${req.path}: ${err.message}`);
    const response: any = { error: err.code, message: err.message };
    if (err instanceof ValidationError && err.details) {
      response.details = err.details;
    }
    res.status(err.statusCode).json(response);
    return;
  }

  // Prisma validation / known request errors → return a useful message
  // instead of the generic INTERNAL_ERROR. The frontend shows `error` to
  // accounts directly; without this they see "INTERNAL_ERROR" toasts that
  // tell them nothing.
  const errName = (err as { name?: string }).name || '';
  if (errName.startsWith('PrismaClient')) {
    const raw = (err as Error).message || '';
    // Pull out the clearest line — Prisma's first non-empty line is usually
    // "Argument X: Invalid value..." or similar.
    const friendly = raw.split('\n').map(l => l.trim()).filter(Boolean).slice(-3).join(' · ');
    console.error(`[PRISMA_ERROR] ${req.method} ${req.path}:`, raw);
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: friendly || 'Database rejected the request — check the input.',
    });
    return;
  }

  console.error(`[INTERNAL_ERROR] ${req.method} ${req.path}:`, err);
  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: (err as Error).message || 'An unexpected error occurred',
  });
};
