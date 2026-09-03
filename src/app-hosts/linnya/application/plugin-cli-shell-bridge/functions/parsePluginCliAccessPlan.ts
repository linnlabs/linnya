import type { BackendPluginCliAccessPlan } from '@linnya/plugin-host-contract/backend';
import { z } from 'zod';

const PluginCliAccessPlanSchema = z.object({
  internalDataAccess: z.enum(['none', 'required']),
  conversationFiles: z.enum(['none', 'write']),
  externalFiles: z.literal('denied'),
  network: z.literal('denied'),
  guiControl: z.literal('denied'),
  localIpcControl: z.literal('denied'),
}).strict();

/** 磁盘插件是运行时 JavaScript，TypeScript contribution 不能充当授权事实。 */
export function parsePluginCliAccessPlan(value: unknown): BackendPluginCliAccessPlan {
  return PluginCliAccessPlanSchema.parse(value);
}
