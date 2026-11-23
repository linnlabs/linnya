import { z } from 'zod';

/** 对话列表中的定时任务折叠项。普通对话没有这一项。 */
export const ScheduledConversationFoldSchema = z.object({
  task_id: z.string().trim().min(1),
  task_name: z.string().min(1),
  unread_count: z.number().int().nonnegative(),
  run_count: z.number().int().nonnegative(),
}).strict();
export type ScheduledConversationFold = z.infer<typeof ScheduledConversationFoldSchema>;
