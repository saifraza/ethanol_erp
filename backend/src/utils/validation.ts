/**
 * Shared input validation utilities.
 * All validators return error string or null.
 */

export function validateNumber(val: any, field: string, opts: { min?: number; max?: number; required?: boolean } = {}): string | null {
  if (val === undefined || val === null || val === '') {
    return opts.required ? `${field} is required` : null;
  }
  const n = Number(val);
  if (isNaN(n)) return `${field} must be a number`;
  if (opts.min !== undefined && n < opts.min) return `${field} must be >= ${opts.min}`;
  if (opts.max !== undefined && n > opts.max) return `${field} must be <= ${opts.max}`;
  return null;
}

export function validateDate(val: any, field: string, opts: { required?: boolean } = {}): string | null {
  if (!val) return opts.required ? `${field} is required` : null;
  const d = new Date(val);
  if (isNaN(d.getTime())) return `${field} is not a valid date`;
  return null;
}

export function validateString(val: any, field: string, opts: { maxLength?: number; required?: boolean } = {}): string | null {
  if (!val || (typeof val === 'string' && !val.trim())) {
    return opts.required ? `${field} is required` : null;
  }
  if (typeof val !== 'string') return `${field} must be a string`;
  if (opts.maxLength && val.length > opts.maxLength) return `${field} must be <= ${opts.maxLength} characters`;
  return null;
}

export function validateEmail(val: any): string | null {
  if (!val) return null;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!re.test(val)) return 'Invalid email format';
  return null;
}

/** Cap pagination params to safe values */
export function safePagination(query: any, defaults = { page: 1, limit: 50, maxLimit: 500 }) {
  const page = Math.max(1, parseInt(query.page) || defaults.page);
  const limit = Math.min(Math.max(1, parseInt(query.limit) || defaults.limit), defaults.maxLimit);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}
