import { z } from 'zod';

/**
 * Conversation UI 消息身份定义。
 *
 * `message_id` 标识一条可渲染、可分页、可作为窗口锚点的 UI 消息。它不是随意的
 * RuntimeEvent ID 别名：多条事实可以归并成一条消息。答案消息由一个 answer segment
 * 唯一承载，因此其 message_id 必须从第一块开始就等于 answer_id，seal 时禁止改名。
 */
export const ConversationMessageIdSchema = z.string().min(1);
export type ConversationMessageId = z.infer<typeof ConversationMessageIdSchema>;

/** 答案段到 UI 消息是一对一映射；集中入口防止调用方改用 chunk/seal event id。 */
export function conversationMessageIdFromAnswerId(answerId: string): ConversationMessageId {
  return ConversationMessageIdSchema.parse(answerId);
}

const ConversationRuntimeIdentityPartSchema = z.string()
  .min(1)
  .refine(value => value === value.trim(), 'identity must not contain leading or trailing whitespace');

/**
 * 工具调用只在所属 run 内唯一，但 Conversation UI message 是全局主键。
 *
 * 因此 Tool message_id 与 merge_key 必须共同从 `run_id + tool_call_id` 派生，不能使用
 * 首个到达事件的 event id。逐段编码后再用冒号分隔，可以避免原始身份自身包含分隔符时
 * 产生碰撞；Host durable projection 与 Renderer live projection 必须只调用这个入口。
 */
export function conversationMessageIdFromToolIdentity(
  runId: string,
  toolCallId: string,
): ConversationMessageId {
  const parsedRunId = ConversationRuntimeIdentityPartSchema.parse(runId);
  const parsedToolCallId = ConversationRuntimeIdentityPartSchema.parse(toolCallId);
  return ConversationMessageIdSchema.parse(
    `tool:${encodeURIComponent(parsedRunId)}:${encodeURIComponent(parsedToolCallId)}`,
  );
}

/**
 * Subrun 详情消息属于 parent trace 派生的独立 read model，不进入 Conversation window。
 * trace 的稳定 owner 是 subrun_id，因此不能伪造 child execution_id，也不能复用父 run 身份。
 */
export function conversationSubrunMessageIdFromToolIdentity(
  subrunId: string,
  toolCallId: string,
): ConversationMessageId {
  const parsedSubrunId = ConversationRuntimeIdentityPartSchema.parse(subrunId);
  const parsedToolCallId = ConversationRuntimeIdentityPartSchema.parse(toolCallId);
  return ConversationMessageIdSchema.parse(
    `subrun-tool:${encodeURIComponent(parsedSubrunId)}:${encodeURIComponent(parsedToolCallId)}`,
  );
}

/**
 * Subrun 的调用 prompt 在详情 read model 中投影为一条只读 user message。
 * 它不是父 Conversation 的 durable user_input，因此使用独立命名空间并只由 subrun_id 定位。
 */
export function conversationSubrunMessageIdFromInvocation(
  subrunId: string,
): ConversationMessageId {
  const parsedSubrunId = ConversationRuntimeIdentityPartSchema.parse(subrunId);
  return ConversationMessageIdSchema.parse(
    `subrun-user:${encodeURIComponent(parsedSubrunId)}`,
  );
}

/** child 摘要事实进入 Subrun 详情时使用独立 read-model 身份，不与主会话摘要行混用。 */
export function conversationSubrunMessageIdFromSummaryIdentity(
  subrunId: string,
  sourceEventId: string,
): ConversationMessageId {
  const parsedSubrunId = ConversationRuntimeIdentityPartSchema.parse(subrunId);
  const parsedSourceEventId = ConversationRuntimeIdentityPartSchema.parse(sourceEventId);
  return ConversationMessageIdSchema.parse(
    `subrun-summary:${encodeURIComponent(parsedSubrunId)}:${encodeURIComponent(parsedSourceEventId)}`,
  );
}
