import { z } from 'zod';

/** 历史软预算是明确的派生状态，Renderer 不读取资产账本或推算被保护资源。 */
export const CanvasVersionBudgetStatusSchema = z
  .object({
    documentId: z.string().min(1),
    usedBytes: z.number().int().nonnegative(),
    budgetBytes: z.number().int().nonnegative(),
    overBudgetBytes: z.number().int().nonnegative(),
  })
  .strict();
export type CanvasVersionBudgetStatus = z.infer<typeof CanvasVersionBudgetStatusSchema>;
