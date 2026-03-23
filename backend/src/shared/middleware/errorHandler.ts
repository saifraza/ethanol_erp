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

  console.error(`[INTERNAL_ERROR] ${req.method} ${req.path}:`, err);
  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
  });
};
