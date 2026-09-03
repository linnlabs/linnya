/**
 * @file runtime-kernel/events/agentEvents.ts
 * @description graph 主执行链使用的严格 Agent 事件合同
 *
 * AgentEvent 是 provider/graph 到 RuntimeEvent admission 之前的内部事实。
 * 所有创建者和消费者都必须引用本文件；映射边界先解析 schema，禁止按字段形状猜测事件。
 */

import { z } from 'zod';
import {
  AnswerSegmentIdSchema,
  AssistantReplayParts,
  FinalAnswerCompletionReason,
  ProviderContinuations,
  RuntimeEventIdSchema,
  RuntimeResourceRefs,
  Status,
  ThoughtMessageIdSchema,
  ToolCallIdSchema,
  ToolCallPhase,
} from '../../contracts';

const UnknownRecord = z.record(z.string(), z.unknown());
const NonBlankIdentifier = z.string().min(1).refine(
  value => value === value.trim(),
  'value must not contain leading or trailing whitespace',
);
const NonBlankText = z.string().min(1).refine(
  value => value.trim().length > 0,
  'value must not be blank',
);

const BaseAgentEvent = z.object({
  type: z.string(),
  timestamp: z.number().finite(),
  /** 事实创建者分配的身份；映射与发布层只读，禁止补造。 */
  id: RuntimeEventIdSchema,
}).strict();

const BaseToolLifecycleAgentEvent = BaseAgentEvent.extend({
  tool_name: NonBlankIdentifier,
  tool_args: UnknownRecord,
  tool_calls: z.array(z.unknown()).optional(),
  /** 由工具调用事实创建者提供；Runtime admission 不补造工具身份。 */
  tool_call_id: ToolCallIdSchema,
  phase: ToolCallPhase,
  status: Status,
  payload: UnknownRecord.optional(),
  meta: UnknownRecord.optional(),
});

export const ThoughtEventSchema = BaseAgentEvent.extend({
  type: z.literal('thought'),
  content: z.string(),
  delta: z.string().optional(),
  is_complete: z.boolean(),
  meta: UnknownRecord.optional(),
  thought_message_id: ThoughtMessageIdSchema.optional(),
}).strict();
export type ThoughtEvent = z.infer<typeof ThoughtEventSchema>;

export const ToolCallDecisionEventSchema = BaseToolLifecycleAgentEvent.extend({
  type: z.literal('tool_call_decision'),
  payload: z
    .object({
      args: UnknownRecord.optional(),
      tool_calls: z.array(z.unknown()).optional(),
      provider_continuations: ProviderContinuations.optional(),
      assistant_replay_parts: AssistantReplayParts.optional(),
    })
    .strict()
    .optional(),
}).strict();
export type ToolCallDecisionEvent = z.infer<typeof ToolCallDecisionEventSchema>;

export const ToolProcessEventSchema = BaseToolLifecycleAgentEvent.extend({
  type: z.literal('tool_process'),
}).strict();
export type ToolProcessEvent = z.infer<typeof ToolProcessEventSchema>;

export const ObservationEventSchema = BaseAgentEvent.extend({
  type: z.literal('observation'),
  tool_name: NonBlankIdentifier,
  /** 必须与对应的工具调用事实使用同一身份。 */
  tool_call_id: ToolCallIdSchema,
  observation: NonBlankText,
  data: z.unknown().optional(),
  error: NonBlankText.optional(),
  /** 失败时由工具 owner 提供的稳定业务错误码。 */
  error_code: NonBlankIdentifier.optional(),
  success: z.boolean(),
  duration_ms: z.number().finite().nonnegative().optional(),
  attachments: RuntimeResourceRefs.optional(),
}).strict();
export type ObservationEvent = z.infer<typeof ObservationEventSchema>;

export const FinalAnswerEventSchema = BaseAgentEvent.extend({
  type: z.literal('final_answer'),
  answer: z.string(),
  /** 由答案事实创建者生成；下游映射和发布层只读。 */
  answer_id: AnswerSegmentIdSchema,
  completion_reason: FinalAnswerCompletionReason,
  provider_continuations: ProviderContinuations.optional(),
  assistant_replay_parts: AssistantReplayParts.optional(),
  meta: UnknownRecord.optional(),
}).strict();
export type FinalAnswerEvent = z.infer<typeof FinalAnswerEventSchema>;

export const ErrorEventSchema = BaseAgentEvent.extend({
  type: z.literal('error'),
  error: z.string(),
  error_code: z.string().optional(),
  retryable: z.boolean().optional(),
  details: UnknownRecord.optional(),
}).strict();
export type ErrorEvent = z.infer<typeof ErrorEventSchema>;

export const StreamChunkEventSchema = BaseAgentEvent.extend({
  type: z.literal('stream_chunk'),
  content: z.string(),
  /** 由 streaming adapter 为当前答案段生成；下游不得替换。 */
  answer_id: AnswerSegmentIdSchema,
  /** 当前 answer_id 内从 0 开始连续递增的序号。 */
  seq: z.number().int().nonnegative(),
  is_last: z.boolean().optional(),
}).strict();
export type StreamChunkEvent = z.infer<typeof StreamChunkEventSchema>;

export const StreamResetEventSchema = BaseAgentEvent.extend({
  type: z.literal('stream_reset'),
  answer_id: AnswerSegmentIdSchema.optional(),
  thought_message_ids: z.array(ThoughtMessageIdSchema).min(1).optional(),
}).strict();
export type StreamResetEvent = z.infer<typeof StreamResetEventSchema>;

export const ProviderContinuationEventSchema = BaseAgentEvent.extend({
  type: z.literal('provider_continuation'),
  continuations: ProviderContinuations.min(1),
}).strict();
export type ProviderContinuationEvent = z.infer<typeof ProviderContinuationEventSchema>;

export const AgentEventSchema = z.discriminatedUnion('type', [
  ThoughtEventSchema,
  ToolCallDecisionEventSchema,
  ToolProcessEventSchema,
  ObservationEventSchema,
  FinalAnswerEventSchema,
  ErrorEventSchema,
  StreamChunkEventSchema,
  StreamResetEventSchema,
  ProviderContinuationEventSchema,
]).superRefine((event, ctx) => {
  if (event.type !== 'observation') return;
  if (event.success && event.data === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['data'], message: 'successful observation requires data' });
  }
  if (!event.success && !event.error) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['error'], message: 'failed observation requires error' });
  }
  if (event.success && event.error_code !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['error_code'], message: 'successful observation must not contain error_code' });
  }
});

export type AgentEvent = z.infer<typeof AgentEventSchema>;
export type AnyAgentEvent = AgentEvent;
