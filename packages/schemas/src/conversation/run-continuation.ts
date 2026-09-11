import { z } from 'zod';

/** 运行控制面不接收消息、工具结果或新的 Agent 配置。 */
export const ConversationRunPauseRequest = z
  .object({
    conversation_id: z.string().min(1),
    expected_execution_id: z.string().min(1),
  })
  .strict();
export type ConversationRunPauseRequest = z.infer<typeof ConversationRunPauseRequest>;

export const ConversationRunContinueRequest = z
  .object({
    conversation_id: z.string().min(1),
    expected_updated_at: z.number().int().nonnegative(),
    expected_execution_id: z.string().min(1),
  })
  .strict();
export type ConversationRunContinueRequest = z.infer<typeof ConversationRunContinueRequest>;
