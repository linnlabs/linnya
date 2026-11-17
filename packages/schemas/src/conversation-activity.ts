import { z } from 'zod';

/** 当前执行事实，不是未读通知；读取不会清除中断，也不授权恢复或审批。 */
export const ConversationActivitySchema = z.object({
  state: z.enum(['running', 'awaiting_answer', 'awaiting_approval', 'interrupted', 'idle', 'unavailable']),
  source: z.enum(['run_registry', 'none']),
  run_id: z.string().min(1).nullable(),
  run_status: z.enum(['pending', 'running', 'awaiting_user', 'paused', 'completed', 'failed', 'cancelled']).nullable(),
  reason: z.enum(['cancelled', 'failed', 'paused', 'approval_unavailable']).nullable(),
  updated_at: z.number().int().nonnegative().nullable(),
  pause: z.object({ settled: z.boolean(), reason: z.string().optional() }).strict().nullable(),
  /** null 表示审批 owner 不可读取，不能当作零个待审批。 */
  pending_approval_count: z.number().int().nonnegative().nullable(),
}).strict();

export type ConversationActivity = z.infer<typeof ConversationActivitySchema>;
