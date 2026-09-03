import { z } from 'zod';

import { ConversationMessageIdSchema, type ConversationMessageId } from './message-identity';

/**
 * Conversation 时间轴和虚拟行使用的视觉轮次身份。
 *
 * visual turn 是 Linnya UI 从可见 user message 派生的产品实体，不是 Linnkit Runtime
 * `turn_id`。两者生命周期与作用域不同，禁止使用普通 string 或同名字段互换。
 */
export const ConversationCompleteVisualTurnIdSchema = z.string()
  .regex(
    /^visual_turn_(?!partial_).+$/,
    'complete visual turn id must use the visual_turn_ namespace',
  )
  .brand<'ConversationCompleteVisualTurnId'>();
export type ConversationCompleteVisualTurnId = z.infer<
  typeof ConversationCompleteVisualTurnIdSchema
>;

export const ConversationPartialVisualTurnIdSchema = z.string()
  .regex(
    /^visual_turn_partial_.+$/,
    'partial visual turn id must use the visual_turn_partial_ namespace',
  )
  .brand<'ConversationPartialVisualTurnId'>();
export type ConversationPartialVisualTurnId = z.infer<
  typeof ConversationPartialVisualTurnIdSchema
>;

export const ConversationVisualTurnIdSchema = z.union([
  ConversationCompleteVisualTurnIdSchema,
  ConversationPartialVisualTurnIdSchema,
]);
export type ConversationVisualTurnId = z.infer<typeof ConversationVisualTurnIdSchema>;

/** 可见 user message 是完整 visual turn 的唯一身份 owner。 */
export function conversationVisualTurnIdFromUserMessageId(
  messageId: ConversationMessageId,
): ConversationCompleteVisualTurnId {
  return ConversationCompleteVisualTurnIdSchema.parse(
    `visual_turn_${ConversationMessageIdSchema.parse(messageId)}`,
  );
}

/**
 * 历史窗口从 assistant message 中段开始时使用的局部视觉分组。
 * 它只保证当前窗口布局稳定，不得写回 Runtime、持久化事实或时间轴索引。
 */
export function conversationPartialVisualTurnIdFromMessageId(
  messageId: ConversationMessageId,
): ConversationPartialVisualTurnId {
  return ConversationPartialVisualTurnIdSchema.parse(
    `visual_turn_partial_${ConversationMessageIdSchema.parse(messageId)}`,
  );
}
