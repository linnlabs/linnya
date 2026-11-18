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

/**
 * 运行中插话：交给正在运行的前台根运行，在一批工具结算后、回到模型前送达。
 * `input_id` 由客户端生成，送达后就是那条 user_input 的事件 id；重发同一 id 幂等。
 */
export const ConversationRunSteerRequest = z
  .object({
    conversation_id: z.string().min(1),
    input_id: z.string().min(1).max(200),
    content: z.string().trim().min(1).max(100_000),
  })
  .strict();
export type ConversationRunSteerRequest = z.infer<typeof ConversationRunSteerRequest>;

export const ConversationRunSteerResponse = z.discriminatedUnion('accepted', [
  z.object({ success: z.literal(true), accepted: z.literal(true), input_id: z.string().min(1) }).strict(),
  /** 运行已不在执行（结束、暂停或不存在）：客户端改走下一次运行。 */
  z.object({ success: z.literal(true), accepted: z.literal(false) }).strict(),
]);
export type ConversationRunSteerResponse = z.infer<typeof ConversationRunSteerResponse>;

export const ConversationRunSteerWithdrawRequest = z
  .object({ conversation_id: z.string().min(1) })
  .strict();
export type ConversationRunSteerWithdrawRequest = z.infer<typeof ConversationRunSteerWithdrawRequest>;

export const ConversationRunSteerWithdrawResponse = z
  .object({
    success: z.literal(true),
    outcome: z.enum(['withdrawn', 'delivered', 'not_found']),
  })
  .strict();
export type ConversationRunSteerWithdrawResponse = z.infer<typeof ConversationRunSteerWithdrawResponse>;

export const ConversationRunSteerDrainRequest = z
  .object({ conversation_id: z.string().min(1) })
  .strict();
export type ConversationRunSteerDrainRequest = z.infer<typeof ConversationRunSteerDrainRequest>;

export const ConversationRunSteerDrainResponse = z
  .object({
    success: z.literal(true),
    inputs: z.array(z.object({
      input_id: z.string().min(1),
      content: z.string(),
      submitted_at: z.number().int().nonnegative(),
    }).strict()),
  })
  .strict();
export type ConversationRunSteerDrainResponse = z.infer<typeof ConversationRunSteerDrainResponse>;
