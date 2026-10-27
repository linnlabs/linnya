import { z } from 'zod';

export const DecisionIdSchema = z.string().trim().min(1).regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/);
export const DecisionTextSchema = z.string().trim().min(1);

/** 输入身份由记录和假设共用；假设只能换值，不能恢复已撤回的来源。 */
export const DecisionInputSchema = z.object({
  id: DecisionIdSchema,
  label: DecisionTextSchema,
  kind: z.enum(['fact', 'preference', 'constraint', 'assumption']),
  value: z.union([z.number().finite(), z.string(), z.boolean(), z.null()]),
  unit: z.string().optional(),
  origin: DecisionTextSchema,
  status: z.enum(['available', 'withdrawn']),
}).strict();
