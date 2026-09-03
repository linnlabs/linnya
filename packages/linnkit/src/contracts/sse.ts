import { z } from 'zod';
import { SerializableJsonRecord, SerializableJsonValue, toSerializableJsonValue } from './json';
import {
  RuntimeEventVisibility,
  RuntimeRunLane,
  RuntimeRunStatus,
  RunExecutionOutcome,
  Status,
  ToolCallPhase,
  type RuntimeEvent,
  type ToolOutputEventResult,
} from './events';
import { FinalAnswerCompletionReason } from './final-answer';
import {
  AnswerSegmentIdSchema,
  ConversationIdSchema,
  ExecutionIdSchema,
  HistoryMessageReferenceIdSchema,
  InteractionIdSchema,
  ResumeTokenSchema,
  RuntimeEventIdSchema,
  RunIdSchema,
  ThoughtMessageIdSchema,
  type ThoughtMessageId,
  ToolCallIdSchema,
  TurnIdSchema,
} from './identity';
import { RuntimeResourceRefs } from './resource-ref';
import { SubRunTracePayload, validateSubRunTracePayloadSemantics } from './sub-run-trace-payload';
import { ContextUsageSnapshot } from './token-usage';

export const BaseSSEEvent = z.object({
  id: RuntimeEventIdSchema,
  timestamp: z.number(),
  conversation_id: ConversationIdSchema,
  turn_id: TurnIdSchema,
  run_id: RunIdSchema.optional(),
  execution_id: ExecutionIdSchema.optional(),
  lane: RuntimeRunLane.optional(),
  visibility: RuntimeEventVisibility.optional(),
  execution_seq: z.number().int().nonnegative().optional(),
  metadata: SerializableJsonRecord.optional(),
});

export type BaseSSEEvent = z.infer<typeof BaseSSEEvent>;

/**
 * 会参与运行期增量归并的 SSE 事件作用域。
 *
 * `turn_id / answer_id / tool_call_id` 只在该作用域内有意义，消费方不得把这些局部 ID
 * 直接提升为 conversation 级索引。execution 身份来自 EventEnvelope，run 身份来自
 * RuntimeEventPublisher，二者都必须是 wire 顶层字段。
 */
export const SSEExecutionScope = z.object({
  run_id: RunIdSchema,
  execution_id: ExecutionIdSchema,
});

export type SSEExecutionScope = z.infer<typeof SSEExecutionScope>;

export function parseSSEExecutionScope(
  event: Pick<BaseSSEEvent, 'run_id' | 'execution_id'>
): SSEExecutionScope {
  return SSEExecutionScope.parse({
    run_id: event.run_id,
    execution_id: event.execution_id,
  });
}

export const SSEThoughtEvent = BaseSSEEvent.extend({
  type: z.literal('thought'),
  thought_message_id: ThoughtMessageIdSchema.optional(),
  delta: z.string().optional(),
  content: z.string().optional(),
  is_complete: z.boolean().default(false),
});

export type SSEThoughtEvent = z.infer<typeof SSEThoughtEvent>;

export const SSEFinalAnswerChunkEvent = BaseSSEEvent.extend({
  type: z.literal('final_answer_chunk'),
  answer_id: AnswerSegmentIdSchema,
  seq: z.number().int().nonnegative(),
  chunk: z.string(),
  is_last: z.boolean().optional(),
});

export type SSEFinalAnswerChunkEvent = z.infer<typeof SSEFinalAnswerChunkEvent>;

export const SSEFinalAnswerResetEvent = BaseSSEEvent.extend({
  type: z.literal('final_answer_reset'),
  answer_id: AnswerSegmentIdSchema.optional(),
  thought_message_ids: z.array(ThoughtMessageIdSchema).optional(),
});

export type SSEFinalAnswerResetEvent = z.infer<typeof SSEFinalAnswerResetEvent>;

export const SSEFinalAnswerEvent = BaseSSEEvent.extend({
  type: z.literal('final_answer'),
  answer_id: AnswerSegmentIdSchema,
  content: z.string(),
  completion_reason: FinalAnswerCompletionReason,
  meta: SerializableJsonRecord.optional(),
});

export type SSEFinalAnswerEvent = z.infer<typeof SSEFinalAnswerEvent>;

export const SSEMarkdownChunkEvent = BaseSSEEvent.extend({
  type: z.literal('markdown_chunk'),
  content_type: z.enum(['text', 'code', 'table', 'image']).default('text'),
  text: z.string(),
  seq: z.number().optional(),
});

export type SSEMarkdownChunkEvent = z.infer<typeof SSEMarkdownChunkEvent>;

const BaseSSEToolLifecycleEvent = BaseSSEEvent.extend({
  tool_name: z.string(),
  tool_call_id: ToolCallIdSchema,
  phase: ToolCallPhase,
  status: Status,
  args: SerializableJsonValue.optional(),
  payload: SerializableJsonValue.optional(),
  meta: SerializableJsonRecord.optional(),
});

export const SSEToolCallDecisionEvent = BaseSSEToolLifecycleEvent.extend({
  type: z.literal('tool_call_decision'),
});

export type SSEToolCallDecisionEvent = z.infer<typeof SSEToolCallDecisionEvent>;

export const SSEToolProcessEvent = BaseSSEToolLifecycleEvent.extend({
  type: z.literal('tool_process'),
});

export type SSEToolProcessEvent = z.infer<typeof SSEToolProcessEvent>;

export const SSEToolOutputEvent = BaseSSEEvent.extend({
  type: z.literal('tool_output'),
  tool_name: z.string(),
  tool_call_id: ToolCallIdSchema,
  status: z.enum(['success', 'error']),
  observation: z.string().refine(value => value.trim().length > 0, 'observation must not be blank'),
  data: SerializableJsonValue.optional(),
  error: z.string().optional(),
  error_code: z.string().trim().min(1).optional(),
  duration_ms: z.number().optional(),
  attachments: RuntimeResourceRefs.optional(),
});

export type SSEToolOutputEvent = z.infer<typeof SSEToolOutputEvent>;

export const SSESubRunTraceEvent = BaseSSEEvent.extend({
  type: z.literal('subrun_trace'),
  ...SubRunTracePayload.shape,
});

export type SSESubRunTraceEvent = z.infer<typeof SSESubRunTraceEvent>;

export const SSERequiresUserInteractionEvent = BaseSSEEvent.extend({
  type: z.literal('requires_user_interaction'),
  form: SerializableJsonValue.optional(),
  interaction_type: z.string().optional(),
  prompt: z.string().optional(),
  interaction_id: InteractionIdSchema,
  run_id: RunIdSchema,
  tool_call_id: ToolCallIdSchema,
  checkpoint_revision: z.number().int().nonnegative(),
  resume_token: ResumeTokenSchema,
  interaction_status: z.literal('pending'),
});

export type SSERequiresUserInteractionEvent = z.infer<typeof SSERequiresUserInteractionEvent>;

export const SSEErrorEvent = BaseSSEEvent.extend({
  type: z.literal('error'),
  error: z.string(),
  details: SerializableJsonValue.optional(),
  error_code: z.string().optional(),
  retryable: z.boolean().optional(),
});

export type SSEErrorEvent = z.infer<typeof SSEErrorEvent>;

/**
 * Host 尚未接纳 run 时发生的请求或传输错误。
 *
 * 它不是 RuntimeEvent，不进入 run history；接纳后的执行错误必须使用 durable `error`。
 */
export const SSETransportErrorEvent = BaseSSEEvent.extend({
  type: z.literal('transport_error'),
  execution_id: ExecutionIdSchema,
  error: z.string(),
  details: SerializableJsonValue.optional(),
  error_code: z.string().optional(),
  retryable: z.boolean().optional(),
});

export type SSETransportErrorEvent = z.infer<typeof SSETransportErrorEvent>;

export const SSEContextUsageSnapshotEvent = BaseSSEEvent.extend({
  type: z.literal('context_usage_snapshot'),
  user_message_id: RuntimeEventIdSchema.optional(),
  context_usage: ContextUsageSnapshot,
});

export type SSEContextUsageSnapshotEvent = z.infer<typeof SSEContextUsageSnapshotEvent>;

export const SSERunExecutionMetricsEvent = BaseSSEEvent.extend({
  type: z.literal('run_execution_metrics'),
  execution_id: ExecutionIdSchema,
  outcome: RunExecutionOutcome,
  duration_ms: z.number().nonnegative(),
  user_message_id: RuntimeEventIdSchema.optional(),
  context_usage: ContextUsageSnapshot.optional(),
});

export type SSERunExecutionMetricsEvent = z.infer<typeof SSERunExecutionMetricsEvent>;

export const SSERunStatusEvent = BaseSSEEvent.extend({
  type: z.literal('run_status'),
  run_id: RunIdSchema,
  execution_id: ExecutionIdSchema,
  status: RuntimeRunStatus,
  reason_message: z.string().optional(),
});

export type SSERunStatusEvent = z.infer<typeof SSERunStatusEvent>;

export const SSETransportEndEvent = BaseSSEEvent.extend({
  type: z.literal('transport_end'),
  execution_id: ExecutionIdSchema,
  reason: z.enum(['complete', 'error', 'interrupted', 'timeout']).optional(),
  reason_message: z.string().optional(),
});

export type SSETransportEndEvent = z.infer<typeof SSETransportEndEvent>;

export const SSEHistorySummaryEvent = BaseSSEEvent.extend({
  type: z.literal('history_summary'),
  /** summary_id 是 summary RuntimeEvent.id 的 wire 别名，不创建第二个身份命名空间。 */
  summary_id: RuntimeEventIdSchema,
  content: z.string(),
  replaced_message_ids: z.array(HistoryMessageReferenceIdSchema),
  original_message_count: z.number().int().nonnegative(),
  summary_seq: z.number().int().nonnegative(),
  compression_ratio: z.number().min(0).max(1).optional(),
  included_old_summary: z.boolean().optional(),
});

export type SSEHistorySummaryEvent = z.infer<typeof SSEHistorySummaryEvent>;

export const SSESummarizationStartEvent = BaseSSEEvent.extend({
  type: z.literal('summarization_start'),
  run_id: RunIdSchema,
  execution_id: ExecutionIdSchema,
  /** 一次摘要 presentation 的稳定身份；start event 本身就是该实体的 owner。 */
  summarization_id: RuntimeEventIdSchema,
});

export type SSESummarizationStartEvent = z.infer<typeof SSESummarizationStartEvent>;

export const SSESummarizationEndEvent = BaseSSEEvent.extend({
  type: z.literal('summarization_end'),
  run_id: RunIdSchema,
  execution_id: ExecutionIdSchema,
  summarization_id: RuntimeEventIdSchema,
  /** 本次 presentation 已完成提交的 durable history_summary 身份。 */
  summary_id: RuntimeEventIdSchema,
  original_message_count: z.number().int().nonnegative(),
  compressed_message_count: z.number().int().nonnegative(),
  compression_ratio: z.number().min(0).max(1).optional(),
});

export type SSESummarizationEndEvent = z.infer<typeof SSESummarizationEndEvent>;

export const SSESummarizationErrorEvent = BaseSSEEvent.extend({
  type: z.literal('summarization_error'),
  run_id: RunIdSchema,
  execution_id: ExecutionIdSchema,
  summarization_id: RuntimeEventIdSchema,
  error: z.string(),
});

export type SSESummarizationErrorEvent = z.infer<typeof SSESummarizationErrorEvent>;

export const SSEEvent = z
  .discriminatedUnion('type', [
    SSEThoughtEvent,
    SSEFinalAnswerChunkEvent,
    SSEFinalAnswerResetEvent,
    SSEFinalAnswerEvent,
    SSEMarkdownChunkEvent,
    SSEToolCallDecisionEvent,
    SSEToolProcessEvent,
    SSEToolOutputEvent,
    SSESubRunTraceEvent,
    SSERequiresUserInteractionEvent,
    SSEErrorEvent,
    SSETransportErrorEvent,
    SSEContextUsageSnapshotEvent,
    SSERunExecutionMetricsEvent,
    SSERunStatusEvent,
    SSETransportEndEvent,
    SSEHistorySummaryEvent,
    SSESummarizationStartEvent,
    SSESummarizationEndEvent,
    SSESummarizationErrorEvent,
  ])
  .superRefine((event, ctx) => {
    if (event.type === 'tool_output') {
      if (event.status === 'success' && event.data === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['data'], message: 'successful tool_output requires data' });
      }
      if (event.status === 'error' && (!event.error || event.error.trim().length === 0)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['error'], message: 'failed tool_output requires error' });
      }
      if (event.status === 'success' && event.error !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['error'], message: 'successful tool_output must not contain error' });
      }
      if (event.status === 'success' && event.error_code !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['error_code'], message: 'successful tool_output must not contain error_code' });
      }
      if (event.status === 'error' && event.data !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['data'], message: 'failed tool_output must not contain data' });
      }
      return;
    }
    if (event.type === 'subrun_trace') {
      validateSubRunTracePayloadSemantics(event, ctx);
      return;
    }
    if (event.type === 'final_answer_chunk' && event.id === event.answer_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['id'],
        message: 'final_answer_chunk event id must differ from answer_id',
      });
    }
    if (event.type === 'final_answer' && event.id !== event.answer_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['id'],
        message: 'final_answer id must equal answer_id',
      });
    }
    if (event.type === 'summarization_start' && event.id !== event.summarization_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['summarization_id'],
        message: 'summarization_start id must equal summarization_id',
      });
    }
  });

export type SSEEvent = z.infer<typeof SSEEvent>;
/** Renderer/transport admission 前的 wire 输入；strict parse 后才可作为 SSEEvent 使用。 */
export type SSEEventInput = z.input<typeof SSEEvent>;

export const validateSSEEvent = (event: unknown) => SSEEvent.safeParse(event);

/**
 * 将持久化 RuntimeEvent 投影成实时 SSEEvent。
 *
 * 中文说明：
 * - RuntimeEvent 是事实源，SSEEvent 是前端实时 wire DTO，二者允许字段名不同；
 * - 这里集中维护官方翻译，避免接入方各自手写 `content/chunk`、summary 字段映射；
 * - 没有实时 UI 语义的 runtime 事件返回 null。
 */
export function runtimeEventToSSEEvent(event: RuntimeEvent): SSEEvent | null {
  const base = toBaseSSEEvent(event);

  switch (event.type) {
    case 'user_input':
    case 'audit_envelope':
    case 'control':
      return null;
    case 'thought':
      return {
        ...base,
        type: 'thought',
        thought_message_id: event.thought_message_id,
        delta: event.is_complete ? undefined : (event.delta ?? event.content),
        content: event.is_complete ? event.content : undefined,
        is_complete: event.is_complete,
      };
    case 'tool_call_decision':
      return {
        ...base,
        type: 'tool_call_decision',
        tool_name: event.tool_name,
        tool_call_id: event.tool_call_id,
        phase: event.phase,
        status: event.status,
        args: event.args,
        payload: toSerializableJsonValue(event.payload),
        meta: event.meta,
      };
    case 'tool_process':
      return {
        ...base,
        type: 'tool_process',
        tool_name: event.tool_name,
        tool_call_id: event.tool_call_id,
        phase: event.phase,
        status: event.status,
        args: event.args,
        payload: event.payload,
        meta: event.meta,
      };
    case 'tool_output':
      return {
        ...base,
        type: 'tool_output',
        tool_name: event.tool_name,
        tool_call_id: event.tool_call_id,
        status: event.status,
        observation: event.observation,
        data: event.data,
        error: event.error,
        error_code: event.error_code,
        duration_ms: event.duration_ms,
        ...(event.attachments ? { attachments: event.attachments } : {}),
      };
    case 'subrun_trace':
      return {
        ...base,
        type: 'subrun_trace',
        parent_tool_call_id: event.parent_tool_call_id,
        subrun_id: event.subrun_id,
        subrun_parent_id: event.subrun_parent_id,
        source_event_id: event.source_event_id,
        kind: event.kind,
        delta: event.delta,
        content: event.content,
        answer_id: event.answer_id,
        seq: event.seq,
        is_last: event.is_last,
        completion_reason: event.completion_reason,
        tool_name: event.tool_name,
        tool_call_id: event.tool_call_id,
        phase: event.phase,
        status: event.status,
        args: event.args,
        tool_calls: event.tool_calls,
        output: event.output,
        attachments: event.attachments,
        duration_ms: event.duration_ms,
        original_message_count: event.original_message_count,
        compression_ratio: event.compression_ratio,
        included_old_summary: event.included_old_summary,
        replaced_message_ids: event.replaced_message_ids,
        meta: event.meta,
      };
    case 'requires_user_interaction':
      return {
        ...base,
        type: 'requires_user_interaction',
        form: event.form,
        interaction_type: event.interaction_type,
        prompt: event.prompt,
        interaction_id: event.interaction_id,
        run_id: event.run_id,
        tool_call_id: event.tool_call_id,
        checkpoint_revision: event.checkpoint_revision,
        resume_token: event.resume_token,
        interaction_status: event.interaction_status,
      };
    case 'final_answer':
      return {
        ...base,
        type: 'final_answer',
        answer_id: event.answer_id,
        content: event.content,
        completion_reason: event.completion_reason,
        meta: event.meta,
      };
    case 'final_answer_chunk':
      return {
        ...base,
        type: 'final_answer_chunk',
        answer_id: event.answer_id,
        seq: event.seq,
        chunk: event.content,
        is_last: event.is_last,
      };
    case 'final_answer_reset':
      return {
        ...base,
        type: 'final_answer_reset',
        answer_id: event.answer_id,
        thought_message_ids: event.thought_message_ids,
      };
    case 'history_summary':
      return {
        ...base,
        type: 'history_summary',
        summary_id: event.id,
        content: event.content,
        replaced_message_ids: event.replaced_message_ids,
        original_message_count: event.original_message_count,
        summary_seq: event.summary_seq,
        compression_ratio: event.compression_ratio,
        included_old_summary: event.included_old_summary,
      };
    case 'error':
      return {
        ...base,
        type: 'error',
        error: event.error,
        details: event.details,
        error_code: event.error_code,
        retryable: event.retryable,
      };
    case 'context_usage_snapshot':
      return {
        ...base,
        type: 'context_usage_snapshot',
        user_message_id: event.user_message_id,
        context_usage: event.context_usage,
      };
    case 'run_execution_metrics':
      return {
        ...base,
        type: 'run_execution_metrics',
        execution_id: event.execution_id,
        outcome: event.outcome,
        duration_ms: event.duration_ms,
        user_message_id: event.user_message_id,
        context_usage: event.context_usage,
      };
  }
  return assertNeverRuntimeEvent(event);
}

function toBaseSSEEvent(event: RuntimeEvent): BaseSSEEvent {
  return {
    id: event.id,
    timestamp: event.timestamp,
    conversation_id: event.conversation_id,
    turn_id: event.turn_id,
    ...(event.run_id === undefined ? {} : { run_id: event.run_id }),
    ...(event.lane === undefined ? {} : { lane: event.lane }),
    ...(event.visibility === undefined ? {} : { visibility: event.visibility }),
    ...(event.metadata === undefined ? {} : { metadata: event.metadata }),
  };
}

function assertNeverRuntimeEvent(event: never): never {
  throw new Error(
    `Unsupported RuntimeEvent type for SSE projection: ${String((event as { type?: unknown }).type)}`
  );
}

type SSEEventCreatorBaseOwnedKey = 'type' | 'id' | 'conversation_id' | 'turn_id';

/** SSE creator 与 Runtime creator 使用同一所有权规则，禁止 options 覆盖显式参数。 */
type SSEEventCreatorOptions<TEvent extends SSEEvent, TOwnedKey extends keyof TEvent = never> = Omit<
  Partial<TEvent>,
  SSEEventCreatorBaseOwnedKey | TOwnedKey
>;

export const createSSEThoughtEvent = (
  id: string,
  conversationId: string,
  turnId: string,
  options: {
    thought_message_id?: ThoughtMessageId;
    delta?: string;
    content?: string;
    is_complete?: boolean;
  } = {}
): SSEThoughtEvent => ({
  ...options,
  type: 'thought',
  id,
  timestamp: Date.now(),
  conversation_id: conversationId,
  turn_id: turnId,
  is_complete: options.is_complete ?? false,
});

export const createSSEFinalAnswerChunkEvent = (
  id: string,
  conversationId: string,
  turnId: string,
  answerId: string,
  seq: number,
  chunk: string,
  options: { is_last?: boolean } = {}
): SSEFinalAnswerChunkEvent => ({
  ...options,
  type: 'final_answer_chunk',
  id,
  timestamp: Date.now(),
  conversation_id: conversationId,
  turn_id: turnId,
  answer_id: answerId,
  seq,
  chunk,
});

export const createSSEFinalAnswerEvent = (
  answerId: string,
  conversationId: string,
  turnId: string,
  content: string,
  options: SSEEventCreatorOptions<
    SSEFinalAnswerEvent,
    'answer_id' | 'content' | 'completion_reason'
  > &
    Pick<SSEFinalAnswerEvent, 'completion_reason'>
): SSEFinalAnswerEvent => ({
  // 核心身份放在 spread 之后，保证直接 JS 调用也不能制造 id/answer_id 分叉。
  ...options,
  type: 'final_answer',
  id: answerId,
  timestamp: options.timestamp ?? Date.now(),
  conversation_id: conversationId,
  turn_id: turnId,
  answer_id: answerId,
  content,
  completion_reason: options.completion_reason,
});

export const createSSEMarkdownChunkEvent = (
  id: string,
  conversationId: string,
  turnId: string,
  text: string,
  options: SSEEventCreatorOptions<SSEMarkdownChunkEvent, 'text' | 'content_type'> = {}
): SSEMarkdownChunkEvent => ({
  ...options,
  type: 'markdown_chunk',
  id,
  timestamp: options.timestamp ?? Date.now(),
  conversation_id: conversationId,
  turn_id: turnId,
  text,
  content_type: 'text',
});

export const createSSEToolCallDecisionEvent = (
  id: string,
  conversationId: string,
  turnId: string,
  toolName: string,
  toolCallId: string,
  phase: SSEToolCallDecisionEvent['phase'],
  status: SSEToolCallDecisionEvent['status'],
  options: SSEEventCreatorOptions<
    SSEToolCallDecisionEvent,
    'tool_name' | 'tool_call_id' | 'phase' | 'status'
  > = {}
): SSEToolCallDecisionEvent => ({
  ...options,
  type: 'tool_call_decision',
  id,
  timestamp: options.timestamp ?? Date.now(),
  conversation_id: conversationId,
  turn_id: turnId,
  tool_name: toolName,
  tool_call_id: ToolCallIdSchema.parse(toolCallId),
  phase,
  status,
});

export const createSSEToolProcessEvent = (
  id: string,
  conversationId: string,
  turnId: string,
  toolName: string,
  toolCallId: string,
  phase: SSEToolProcessEvent['phase'],
  status: SSEToolProcessEvent['status'],
  options: SSEEventCreatorOptions<
    SSEToolProcessEvent,
    'tool_name' | 'tool_call_id' | 'phase' | 'status'
  > = {}
): SSEToolProcessEvent => ({
  ...options,
  type: 'tool_process',
  id,
  timestamp: options.timestamp ?? Date.now(),
  conversation_id: conversationId,
  turn_id: turnId,
  tool_name: toolName,
  tool_call_id: ToolCallIdSchema.parse(toolCallId),
  phase,
  status,
});

export const createSSEToolOutputEvent = (
  id: string,
  conversationId: string,
  turnId: string,
  toolName: string,
  toolCallId: string,
  result: ToolOutputEventResult,
  options: SSEEventCreatorOptions<
    SSEToolOutputEvent,
    'tool_name' | 'tool_call_id' | 'status' | 'observation' | 'data' | 'error' | 'error_code'
  > = {}
): SSEToolOutputEvent => SSEToolOutputEvent.parse({
  ...options,
  type: 'tool_output',
  id,
  timestamp: options.timestamp ?? Date.now(),
  conversation_id: conversationId,
  turn_id: turnId,
  tool_name: toolName,
  tool_call_id: ToolCallIdSchema.parse(toolCallId),
  status: result.status,
  observation: result.observation,
  ...(result.status === 'success'
    ? { data: toSerializableJsonValue(result.data) }
    : {
        error: result.error,
        ...(result.error_code === undefined ? {} : { error_code: result.error_code }),
      }),
});

export const createSSESubRunTraceEvent = (
  id: string,
  conversationId: string,
  turnId: string,
  parentToolCallId: string,
  subrunId: string,
  kind: SSESubRunTraceEvent['kind'],
  options: SSEEventCreatorOptions<
    SSESubRunTraceEvent,
    'parent_tool_call_id' | 'subrun_id' | 'kind'
  > &
    Pick<SSESubRunTraceEvent, 'source_event_id'>
): SSESubRunTraceEvent => ({
  ...options,
  type: 'subrun_trace',
  id,
  timestamp: options.timestamp ?? Date.now(),
  conversation_id: conversationId,
  turn_id: turnId,
  parent_tool_call_id: ToolCallIdSchema.parse(parentToolCallId),
  subrun_id: subrunId,
  kind,
});

export const createSSERequiresUserInteractionEvent = (
  id: string,
  conversationId: string,
  turnId: string,
  options: SSEEventCreatorOptions<SSERequiresUserInteractionEvent> &
    Pick<
      SSERequiresUserInteractionEvent,
      | 'interaction_id'
      | 'run_id'
      | 'tool_call_id'
      | 'checkpoint_revision'
      | 'resume_token'
      | 'interaction_status'
    >
): SSERequiresUserInteractionEvent => ({
  ...options,
  type: 'requires_user_interaction',
  id,
  timestamp: options.timestamp ?? Date.now(),
  conversation_id: conversationId,
  turn_id: turnId,
});

export const createSSEErrorEvent = (
  id: string,
  conversationId: string,
  turnId: string,
  error: string,
  options: SSEEventCreatorOptions<SSEErrorEvent, 'error'> = {}
): SSEErrorEvent => ({
  ...options,
  type: 'error',
  id,
  timestamp: options.timestamp ?? Date.now(),
  conversation_id: conversationId,
  turn_id: turnId,
  error,
});

export const createSSETransportErrorEvent = (
  id: string,
  conversationId: string,
  turnId: string,
  error: string,
  options: SSEEventCreatorOptions<SSETransportErrorEvent, 'error'> &
    Pick<SSETransportErrorEvent, 'execution_id'>
): SSETransportErrorEvent => ({
  ...options,
  type: 'transport_error',
  id,
  timestamp: options.timestamp ?? Date.now(),
  conversation_id: conversationId,
  turn_id: turnId,
  error,
});

export const createSSERunStatusEvent = (
  id: string,
  conversationId: string,
  turnId: string,
  options: SSEEventCreatorOptions<SSERunStatusEvent> &
    Pick<SSERunStatusEvent, 'run_id' | 'execution_id' | 'status'>
): SSERunStatusEvent => ({
  ...options,
  type: 'run_status',
  id,
  timestamp: options.timestamp ?? Date.now(),
  conversation_id: conversationId,
  turn_id: turnId,
});

export const createSSETransportEndEvent = (
  id: string,
  conversationId: string,
  turnId: string,
  options: SSEEventCreatorOptions<SSETransportEndEvent> & Pick<SSETransportEndEvent, 'execution_id'>
): SSETransportEndEvent => ({
  ...options,
  type: 'transport_end',
  id,
  timestamp: options.timestamp ?? Date.now(),
  conversation_id: conversationId,
  turn_id: turnId,
});

export const createSSEHistorySummaryEvent = (
  id: string,
  conversationId: string,
  turnId: string,
  content: string,
  replacedMessageIds: readonly string[],
  originalMessageCount: number,
  summarySeq: number,
  options: SSEEventCreatorOptions<
    SSEHistorySummaryEvent,
    'summary_id' | 'content' | 'replaced_message_ids' | 'original_message_count' | 'summary_seq'
  > = {}
): SSEHistorySummaryEvent => ({
  ...options,
  type: 'history_summary',
  id,
  timestamp: options.timestamp ?? Date.now(),
  conversation_id: conversationId,
  turn_id: turnId,
  summary_id: id,
  content,
  replaced_message_ids: [...replacedMessageIds],
  original_message_count: originalMessageCount,
  summary_seq: summarySeq,
});
