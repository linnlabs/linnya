import { z } from 'zod';

import { JsonRecordSchema } from '../json-value';
import { ConversationUiSpecSchema } from './presentation';
import { UserQuoteSchema } from './user-quote';

/** 外部活动只表达运行归属，不参与消息 identity 或视觉轮次分组。 */
export const ConversationActivityBindingSchema = z.object({
  runId: z.string().trim().min(1),
  feature: z.string().trim().min(1),
}).strict();
export type ConversationActivityBinding = z.infer<typeof ConversationActivityBindingSchema>;

/**
 * 插件写入用户消息的唯一扩展槽。
 *
 * 核心 metadata 禁止 catchall；插件数据必须携带 namespace 并收进 data，避免插件字段
 * 与 Conversation 后续新增字段撞名。Conversation 只持久化，不解释 data 内部语义。
 */
export const ConversationMessageExtensionSchema = z.object({
  namespace: z.string().trim().min(1),
  data: JsonRecordSchema,
}).strict();
export type ConversationMessageExtension = z.infer<typeof ConversationMessageExtensionSchema>;

export const ConversationAgentWorkOutcomeSchema = z.enum([
  'completed',
  'awaiting_user',
  'failed',
  'cancelled',
]);
export type ConversationAgentWorkOutcome = z.infer<typeof ConversationAgentWorkOutcomeSchema>;

export const ConversationAgentWorkSchema = z.object({
  duration_ms: z.number().finite().nonnegative(),
  ended_at: z.number().finite(),
  outcome: ConversationAgentWorkOutcomeSchema,
}).strict();
export type ConversationAgentWork = z.infer<typeof ConversationAgentWorkSchema>;

const conversationContextUsageTokenCount = z.number().int().nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const conversationContextUsageSafeInteger = z.number().int()
  .min(Number.MIN_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);

/** Conversation UI 需要持久化的最近成功 Prompt 占用，不承载 LinnKit 内部测量策略。 */
export const ConversationContextUsageSchema = z.object({
  budget_model_id: z.string().trim().min(1),
  served_model_id: z.string().trim().min(1).optional(),
  used_tokens: conversationContextUsageTokenCount,
  components: z.object({
    system_prompt_tokens: conversationContextUsageTokenCount,
    conversation_tokens: conversationContextUsageTokenCount,
    tool_definition_tokens: conversationContextUsageTokenCount,
  }).strict(),
  input_budget_tokens: conversationContextUsageTokenCount.positive(),
  remaining_tokens: conversationContextUsageSafeInteger,
  output_limit_tokens: conversationContextUsageTokenCount.positive(),
  source: z.enum([
    'local-estimate',
    'provider-preflight-count',
    'provider-response-usage',
    'host-supplied',
    'test-fixture',
  ]),
  confidence: z.enum(['estimate', 'provider-estimate', 'actual']),
}).strict().superRefine((usage, context) => {
  const componentTotal = usage.components.system_prompt_tokens
    + usage.components.conversation_tokens
    + usage.components.tool_definition_tokens;
  if (componentTotal !== usage.used_tokens) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['components'],
      message: 'Context usage components 之和必须等于 used_tokens。',
    });
  }
  if (usage.remaining_tokens !== usage.input_budget_tokens - usage.used_tokens) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['remaining_tokens'],
      message: 'remaining_tokens 必须等于 input_budget_tokens - used_tokens。',
    });
  }
});
export type ConversationContextUsage = z.infer<typeof ConversationContextUsageSchema>;

/** 从通用运行事实显式挑选产品 read model 字段，避免把 LinnKit 内部字段持久化到 Conversation。 */
export function projectConversationContextUsage(
  usage: ConversationContextUsage,
): ConversationContextUsage {
  return ConversationContextUsageSchema.parse({
    budget_model_id: usage.budget_model_id,
    ...(usage.served_model_id ? { served_model_id: usage.served_model_id } : {}),
    used_tokens: usage.used_tokens,
    components: { ...usage.components },
    input_budget_tokens: usage.input_budget_tokens,
    remaining_tokens: usage.remaining_tokens,
    output_limit_tokens: usage.output_limit_tokens,
    source: usage.source,
    confidence: usage.confidence,
  });
}

/** Renderer -> Host 与 commit ack 共用的 user_input metadata。 */
export const ConversationUserInputMetadataSchema = z.object({
  user_quote: UserQuoteSchema.optional(),
  ui: ConversationUiSpecSchema.optional(),
  activity: ConversationActivityBindingSchema.optional(),
  extension: ConversationMessageExtensionSchema.optional(),
}).strict();
export type ConversationUserInputMetadata = z.infer<typeof ConversationUserInputMetadataSchema>;

/** durable user_input row 的 payload；presentation 已提升到 DTO 顶层，不在 payload 重复。 */
export const ConversationUserMessagePayloadSchema = z.object({
  user_quote: UserQuoteSchema.optional(),
  activity: ConversationActivityBindingSchema.optional(),
  extension: ConversationMessageExtensionSchema.optional(),
  agent_work: ConversationAgentWorkSchema.optional(),
  context_usage: ConversationContextUsageSchema.optional(),
}).strict();
export type ConversationUserMessagePayload = z.infer<typeof ConversationUserMessagePayloadSchema>;

const ConversationMessageScopeFields = {
  turn_id: z.string().trim().min(1),
  run_id: z.string().trim().min(1),
  execution_id: z.string().trim().min(1).optional(),
  merge_key: z.string().trim().min(1).optional(),
  ui: ConversationUiSpecSchema.optional(),
} as const;

export const ConversationUserMessageMetadataSchema = z.object({
  ...ConversationUserMessagePayloadSchema.shape,
  turn_id: z.string().trim().min(1).optional(),
  run_id: z.string().trim().min(1).optional(),
  execution_id: z.string().trim().min(1).optional(),
  merge_key: z.string().trim().min(1).optional(),
  ui: ConversationUiSpecSchema.optional(),
}).strict();
export type ConversationUserMessageMetadata = z.infer<typeof ConversationUserMessageMetadataSchema>;

const ConversationThoughtMessageCommonFields = {
  thought_started_at: z.number().finite(),
  activity: ConversationActivityBindingSchema.optional(),
} as const;

const ConversationStreamingThoughtMessagePayloadSchema = z.object({
  ...ConversationThoughtMessageCommonFields,
  is_complete: z.literal(false),
}).strict();

const ConversationCompletedThoughtMessagePayloadSchema = z.object({
  ...ConversationThoughtMessageCommonFields,
  is_complete: z.literal(true),
  thought_completed_at: z.number().finite(),
}).strict();

/** Thought 完成状态决定完成时间是否存在，类型层与运行时合同保持一致。 */
export const ConversationThoughtMessagePayloadSchema = z.discriminatedUnion('is_complete', [
  ConversationStreamingThoughtMessagePayloadSchema,
  ConversationCompletedThoughtMessagePayloadSchema,
]);
export type ConversationThoughtMessagePayload = z.infer<typeof ConversationThoughtMessagePayloadSchema>;

const ConversationStreamingThoughtMessageMetadataSchema = z.object({
  ...ConversationThoughtMessageCommonFields,
  ...ConversationMessageScopeFields,
  is_complete: z.literal(false),
}).strict();

const ConversationCompletedThoughtMessageMetadataSchema = z.object({
  ...ConversationThoughtMessageCommonFields,
  ...ConversationMessageScopeFields,
  is_complete: z.literal(true),
  thought_completed_at: z.number().finite(),
}).strict();

export const ConversationThoughtMessageMetadataSchema = z.discriminatedUnion('is_complete', [
  ConversationStreamingThoughtMessageMetadataSchema,
  ConversationCompletedThoughtMessageMetadataSchema,
]);
export type ConversationThoughtMessageMetadata = z.infer<typeof ConversationThoughtMessageMetadataSchema>;

export const ConversationAnswerCompletionReasonSchema = z.enum([
  'terminal',
  'tool_call',
  'interrupted',
]);
export type ConversationAnswerCompletionReason = z.infer<
  typeof ConversationAnswerCompletionReasonSchema
>;

const ConversationAnswerCommonFields = {
  answer_id: z.string().trim().min(1),
  final_meta: JsonRecordSchema.optional(),
  first_token_at: z.number().finite(),
  activity: ConversationActivityBindingSchema.optional(),
} as const;

/** durable answer payload 已经 seal，完成状态必须与封口原因严格一致。 */
export const ConversationTerminalAnswerPayloadSchema = z.object({
  ...ConversationAnswerCommonFields,
  is_complete: z.literal(true),
  completion_reason: z.literal('terminal'),
}).strict();
export const ConversationToolPreamblePayloadSchema = z.object({
  ...ConversationAnswerCommonFields,
  is_complete: z.literal(true),
  completion_reason: z.literal('tool_call'),
}).strict();
export const ConversationPartialAnswerPayloadSchema = z.object({
  ...ConversationAnswerCommonFields,
  is_complete: z.literal(false),
  completion_reason: z.literal('interrupted'),
}).strict();
export const ConversationAnswerMessagePayloadSchema = z.union([
  ConversationTerminalAnswerPayloadSchema,
  ConversationToolPreamblePayloadSchema,
  ConversationPartialAnswerPayloadSchema,
]);
export type ConversationAnswerMessagePayload = z.infer<typeof ConversationAnswerMessagePayloadSchema>;

const ConversationAnswerRendererScopeFields = {
  last_seq: z.number().int().nonnegative().optional(),
  seal_source_event_id: z.string().trim().min(1).optional(),
  ...ConversationMessageScopeFields,
} as const;

/** chunk stream 尚未被 final_answer 事实 seal；is_complete 只表达 chunk 是否已收齐。 */
export const ConversationUnsealedAnswerMessageMetadataSchema = z.object({
  ...ConversationAnswerCommonFields,
  ...ConversationAnswerRendererScopeFields,
  is_complete: z.boolean(),
  completion_reason: z.undefined().optional(),
}).strict();
export const ConversationTerminalAnswerMessageMetadataSchema = z.object({
  ...ConversationAnswerCommonFields,
  ...ConversationAnswerRendererScopeFields,
  is_complete: z.literal(true),
  completion_reason: z.literal('terminal'),
}).strict();
export const ConversationToolPreambleMessageMetadataSchema = z.object({
  ...ConversationAnswerCommonFields,
  ...ConversationAnswerRendererScopeFields,
  is_complete: z.literal(true),
  completion_reason: z.literal('tool_call'),
}).strict();
export const ConversationPartialAnswerMessageMetadataSchema = z.object({
  ...ConversationAnswerCommonFields,
  ...ConversationAnswerRendererScopeFields,
  is_complete: z.literal(false),
  completion_reason: z.literal('interrupted'),
}).strict();

export const ConversationFinalAnswerMessageMetadataSchema = z.union([
  ConversationUnsealedAnswerMessageMetadataSchema,
  ConversationTerminalAnswerMessageMetadataSchema,
]);

/** live 与 durable answer 共用的严格状态联合，不允许完成状态与封口原因矛盾。 */
export const ConversationAnswerMessageMetadataSchema = z.union([
  ConversationFinalAnswerMessageMetadataSchema,
  ConversationToolPreambleMessageMetadataSchema,
  ConversationPartialAnswerMessageMetadataSchema,
]);
export type ConversationAnswerMessageMetadata = z.infer<typeof ConversationAnswerMessageMetadataSchema>;
export type ConversationUnsealedAnswerMessageMetadata = z.infer<
  typeof ConversationUnsealedAnswerMessageMetadataSchema
>;
export type ConversationTerminalAnswerMessageMetadata = z.infer<
  typeof ConversationTerminalAnswerMessageMetadataSchema
>;
export type ConversationToolPreambleMessageMetadata = z.infer<
  typeof ConversationToolPreambleMessageMetadataSchema
>;
export type ConversationPartialAnswerMessageMetadata = z.infer<
  typeof ConversationPartialAnswerMessageMetadataSchema
>;

export function parseConversationAnswerMessageMetadata(
  type: 'final_answer',
  value: unknown,
): ConversationUnsealedAnswerMessageMetadata | ConversationTerminalAnswerMessageMetadata;
export function parseConversationAnswerMessageMetadata(
  type: 'tool_preamble',
  value: unknown,
): ConversationToolPreambleMessageMetadata;
export function parseConversationAnswerMessageMetadata(
  type: 'partial_answer',
  value: unknown,
): ConversationPartialAnswerMessageMetadata;
export function parseConversationAnswerMessageMetadata(
  type: 'final_answer' | 'tool_preamble' | 'partial_answer',
  value: unknown,
): ConversationAnswerMessageMetadata {
  switch (type) {
    case 'final_answer':
      return ConversationFinalAnswerMessageMetadataSchema.parse(value);
    case 'tool_preamble':
      return ConversationToolPreambleMessageMetadataSchema.parse(value);
    case 'partial_answer':
      return ConversationPartialAnswerMessageMetadataSchema.parse(value);
  }
}
