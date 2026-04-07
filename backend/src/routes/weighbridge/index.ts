import { Router } from 'express';
import { registerPushRoutes } from './push';
import { registerOtherRoutes } from './endpoints';

/**
 * Weighbridge router — assembles routes from push.ts (the dispatcher) and
 * endpoints.ts (all other endpoints like /weighment, /lab-results, /master-data,
 * /heartbeat, /system-status, /weighments, /factory-users).
 *
 * The /push endpoint is split into type-specific handlers under handlers/.
 * See plan: .claude/plans/optimized-whistling-hopcroft.md
 */
const router = Router();
registerPushRoutes(router);
registerOtherRoutes(router);

export default router;
