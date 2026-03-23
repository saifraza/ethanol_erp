import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { ValidationError } from '../errors';

/**
 * Zod validation middleware.
 * Validates req.body against a Zod schema.
 * On success: replaces req.body with parsed (typed) data.
 * On failure: throws ValidationError with details.
 */
export const validate = (schema: ZodSchema) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      throw new ValidationError('Invalid request data', result.error.flatten());
    }
    req.body = result.data;
    next();
  };
