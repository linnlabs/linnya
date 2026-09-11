import { z } from 'zod';

/** 与 Supervisor 激活事务同存的原响应引用；不能由聊天历史猜造。 */
export const CommittedResumeInputsSchema = z
  .object({
    eventIds: z.array(z.string().min(1)).min(1),
    checkpointRevision: z.number().int().nonnegative(),
  })
  .strict();
