/**
 * Request-scoped context — carries the current user + route info from the
 * Express auth middleware down into the Prisma layer (so the activity logger
 * can record WHO did each write without touching every route).
 *
 * Backed by Node's AsyncLocalStorage. Set once per request in middleware,
 * read anywhere downstream during the same async chain.
 */

import { AsyncLocalStorage } from 'async_hooks';
import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';

export interface RequestContext {
  userId: string | null;
  userName: string | null;
  userRole: string | null;
  routePath: string | null;
  ipAddress: string | null;
  // Bypass flag — set by long-running batch jobs that don't want their writes
  // to clog the activity log (e.g. nightly seeding).
  skipActivityLog: boolean;
}

const _als = new AsyncLocalStorage<RequestContext>();

/** Read the current request context (if any). Returns null outside requests. */
export function getRequestContext(): RequestContext | null {
  return _als.getStore() ?? null;
}

/** Run a function with a specific context (useful for tests + background jobs). */
export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return _als.run(ctx, fn);
}

/** CLI helper — wrap a script's main() so all its Prisma writes are tagged
 *  with the given user in ActivityLog. Use `await flushActivityLogs()` in
 *  the script's finally block before calling process.exit to ensure pending
 *  audit rows are written.
 *
 *  Example:
 *    import { runAsCliUser } from '../src/services/requestContext';
 *    import { flushActivityLogs } from '../src/services/activityLogger';
 *    runAsCliUser('Saif', main).finally(async () => {
 *      await flushActivityLogs();
 *      process.exit(0);
 *    });
 */
export async function runAsCliUser<T>(userName: string, fn: () => Promise<T>): Promise<T> {
  const ctx: RequestContext = {
    userId: `cli-${userName.toLowerCase().replace(/\s+/g, '-')}`,
    userName,
    userRole: 'ADMIN',
    routePath: 'CLI script',
    ipAddress: 'cli',
    skipActivityLog: false,
  };
  return await _als.run(ctx, fn);
}

/** Mutate the current request's user context (called by auth middleware AFTER
 *  it decodes the JWT — the requestContextMiddleware mounts earlier). */
export function setUserOnContext(user: { id: string; name: string; role: string }): void {
  const ctx = _als.getStore();
  if (!ctx) return;
  ctx.userId = user.id;
  ctx.userName = user.name;
  ctx.userRole = user.role;
}

/**
 * Express middleware — wrap each request in an AsyncLocalStorage context.
 * Mount EARLY in the middleware chain (before any route handler). For
 * authenticated routes, the auth middleware will populate userId/Name/Role
 * later via setUserOnContext().
 */
export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const ar = req as AuthRequest;
  const ctx: RequestContext = {
    userId: ar.user?.id ?? null,
    userName: ar.user?.name ?? null,
    userRole: ar.user?.role ?? null,
    routePath: `${req.method} ${req.originalUrl.split('?')[0]}`,
    ipAddress: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket?.remoteAddress
      || null,
    skipActivityLog: false,
  };
  _als.run(ctx, () => next());
}
