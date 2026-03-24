/**
 * Auto-Collect Module Registry
 *
 * To add a new module:
 * 1. Copy _template.ts → yourModule.ts
 * 2. Define steps, fields, parser, saver
 * 3. Import and add to MODULE_REGISTRY below
 */

import { ModuleConfig } from './types';
import decanterConfig from './decanter';

// ── Registry ── Add new modules here
export const MODULE_REGISTRY: Record<string, ModuleConfig> = {
  decanter: decanterConfig,
  // evaporation: evaporationConfig,
  // dryer: dryerConfig,
  // distillation: distillationConfig,
};

export type { ModuleConfig, CollectStep } from './types';
