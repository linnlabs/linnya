import { z } from 'zod';
import { AuditEnvelope } from './audit';
import { SerializableJsonRecord, SerializableJsonValue, toSerializableJsonValue } from './json';
import { RuntimeResourceRefs } from './resource-ref';
import { Status, ToolCallPhase } from './runtime-status';
import { FinalAnswerCompletionReason } from './final-answer';
import { AssistantReplayParts, ProviderContinuations } from './provider-continuation';
import {
  AnswerSegmentIdSchema,
  ControlTargetReferenceIdSchema,
  ConversationIdSchema,
  ExecutionIdSchema,
  HistoryMessageReferenceIdSchema,
  InteractionIdSchema,
  RuntimeEventIdSchema,
  RunIdSchema,
  ResumeTokenSchema,
  ThoughtMessageIdSchema,
  ToolCallIdSchema,
  TurnIdSchema,
} from './identity';
import { SubRunTracePayload, validateSubRunTracePayloadSemantics } from './sub-run-trace-payload';
import { ContextUsageSnapshot } from './token-usage';

export const RuntimeRunLane = z.enum(['foreground', 'auxiliary', 'child']);
export type RuntimeRunLane = z.infer<typeof RuntimeRunLane>;

export const RuntimeEventVisibility = z.enum(['conversation', 'parent-trace', 'none']);
export type RuntimeEventVisibility = z.infer<typeof RuntimeEventVisibility>;

export const RuntimeRunStatus = z.enum([
  'pending',
  'running',
  'awaiting_user',
  'paused',
  'completed',
  'failed',
  'cancelled',
]);
export type RuntimeRunStatus = z.infer<typeof RuntimeRunStatus>;

export const RunExecutionOutcome = z.enum(['completed', 'awaiting_user', 'failed', 'cancelled']);
export type RunExecutionOutcome = z.infer<typeof RunExecutionOutcome>;

/**
 * 运行时事实的正式路由身份。
 *
 * 这些字段决定事件属于哪个 run、由谁控制、可以投影到哪里，不能放进开放 metadata。
 */
export const RuntimeEventRoutingIdentity = z
  .object({
    run_id: RunIdSchema,
    parent_run_id: RunIdSchema.optional(),
    lane: RuntimeRunLane,
    visibility: RuntimeEventVisibility,
  })
  .strict();
export type RuntimeEventRoutingIdentity = z.infer<typeof RuntimeEventRoutingIdentity>;

export const BaseEvent = z.object({
  id: RuntimeEventIdSchema,
  conversation_id: ConversationIdSchema,
  timestamp: z.number(),
  metadata: SerializableJsonRecord.optional(),
  version: z.literal(1).default(1),
  turn_id: TurnIdSchema,
  ephemeral: z.boolean().optional(),
  run_id: RunIdSchema.optional(),
  parent_run_id: RunIdSchema.optional(),
  lane: RuntimeRunLane.optional(),
  visibility: RuntimeEventVisibility.optional(),
});

export { Status, ToolCallPhase } from './runtime-status';

export const ToolCallDecisionPayload = z
  .object({
    args: SerializableJsonRecord.optional(),
    tool_calls: z.array(SerializableJsonValue).optional(),
    /**
     * 已绑定 producer route identity 的 Provider continuation。
     *
     * 聚合 continuation 只用于事实查询；回放权威顺序由 assistant_replay_parts 持有。
     */
    provider_continuations: ProviderContinuations.optional(),
    assistant_replay_parts: AssistantReplayParts.optional(),
  })
  .strict();

export type ToolCallDecisionPayload = z.infer<typeof ToolCallDecisionPayload>;

const RuntimeEventShape = z.discriminatedUnion('type', [
  BaseEvent.extend({
    type: z.literal('user_input'),
    content: z.string(),
    raw_content: z.string().optional(),
    source: z.enum(['user', 'editor', 'system']).default('user'),
    attachments: RuntimeResourceRefs.optional(),
  }),
  BaseEvent.extend({
    type: z.literal('thought'),
    content: z.string(),
    thought_message_id: ThoughtMessageIdSchema.optional(),
    delta: z.string().optional(),
    is_complete: z.boolean().default(false),
  }),
  BaseEvent.extend({
    type: z.literal('tool_call_decision'),
    tool_name: z.string(),
    tool_call_id: ToolCallIdSchema,
    phase: ToolCallPhase,
    status: Status,
    args: SerializableJsonRecord.optional(),
    payload: ToolCallDecisionPayload.optional(),
    parent_tool_call_id: ToolCallIdSchema.optional(),
    meta: SerializableJsonRecord.optional(),
  }),
  BaseEvent.extend({
    type: z.literal('tool_process'),
    tool_name: z.string(),
    tool_call_id: ToolCallIdSchema,
    phase: ToolCallPhase,
    status: Status,
    args: SerializableJsonRecord.optional(),
    payload: SerializableJsonRecord.optional(),
    parent_tool_call_id: ToolCallIdSchema.optional(),
    meta: SerializableJsonRecord.optional(),
  }),
  BaseEvent.extend({
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
  }),
  BaseEvent.extend({
    type: z.literal('subrun_trace'),
    /** parent trace 是实时展示协议，历史由 Host 紧凑 read model 持有。 */
    ephemeral: z.literal(true),
    ...SubRunTracePayload.shape,
  }),
  BaseEvent.extend({
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
  }),
  BaseEvent.extend({
    type: z.literal('audit_envelope'),
    envelope: AuditEnvelope,
  }),
  BaseEvent.extend({
    type: z.literal('final_answer'),
    answer_id: AnswerSegmentIdSchema,
    content: z.string(),
    is_complete: z.boolean().default(true),
    /** 封口原因由事实创建者确定；读取方不得根据相邻事件推断。 */
    completion_reason: FinalAnswerCompletionReason,
    provider_continuations: ProviderContinuations.optional(),
    assistant_replay_parts: AssistantReplayParts.optional(),
    meta: SerializableJsonRecord.optional(),
  }),
  BaseEvent.extend({
    type: z.literal('final_answer_chunk'),
    answer_id: AnswerSegmentIdSchema,
    seq: z.number().int().nonnegative(),
    content: z.string(),
    is_last: z.boolean().optional(),
  }),
  BaseEvent.extend({
    type: z.literal('final_answer_reset'),
    answer_id: AnswerSegmentIdSchema.optional(),
    thought_message_ids: z.array(ThoughtMessageIdSchema).optional(),
  }),
  BaseEvent.extend({
    type: z.literal('history_summary'),
    content: z.string(),
    replaced_message_ids: z.array(HistoryMessageReferenceIdSchema),
    summary_seq: z.number().int().nonnegative(),
    original_message_count: z.number().int().nonnegative(),
    compression_ratio: z.number().min(0).max(1).optional(),
    included_old_summary: z.boolean().optional(),
  }),
  BaseEvent.extend({
    type: z.literal('error'),
    error: z.string(),
    details: SerializableJsonValue.optional(),
    error_code: z.string().optional(),
    retryable: z.boolean().optional(),
  }),
  BaseEvent.extend({
    type: z.literal('control'),
    op: z.enum(['truncate_after', 'replace', 'redo', 'branch']),
    target_id: ControlTargetReferenceIdSchema.optional(),
    reason: z.string().optional(),
    meta: SerializableJsonValue.optional(),
  }),
  BaseEvent.extend({
    type: z.literal('context_usage_snapshot'),
    /** 运行中的最新成功 Prompt 快照只服务实时展示；最终值由 execution metrics 持久化。 */
    ephemeral: z.literal(true),
    user_message_id: RuntimeEventIdSchema.optional(),
    context_usage: ContextUsageSnapshot,
  }),
  BaseEvent.extend({
    type: z.literal('run_execution_metrics'),
    execution_id: ExecutionIdSchema,
    outcome: RunExecutionOutcome,
    duration_ms: z.number().nonnegative(),
    user_message_id: RuntimeEventIdSchema.optional(),
    context_usage: ContextUsageSnapshot.optional(),
  }),
]);

export const RuntimeEvent = z
  .unknown()
  .superRefine((value, ctx) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const type = Reflect.get(value, 'type');
    if (
      Object.prototype.hasOwnProperty.call(value, 'attachments')
      && type !== 'user_input'
      && type !== 'tool_output'
      && type !== 'subrun_trace'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['attachments'],
        message: 'attachments are only allowed on user_input, tool_output and admitted subrun_trace events',
      });
    }
    if (Object.prototype.hasOwnProperty.call(value, 'reasoning_details')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reasoning_details'],
        message: 'reasoning_details is retired; use provider_continuations with producer identity',
      });
    }
    const payload = Reflect.get(value, 'payload');
    if (
      payload
      && typeof payload === 'object'
      && !Array.isArray(payload)
      && Object.prototype.hasOwnProperty.call(payload, 'reasoning_details')
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payload', 'reasoning_details'],
        message: 'reasoning_details is retired; use provider_continuations with producer identity',
      });
    }
  })
  .pipe(RuntimeEventShape)
  .superRefine((event, ctx) => {
    if (
      event.type === 'final_answer'
      && event.provider_continuations?.length
      && !event.assistant_replay_parts?.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['assistant_replay_parts'],
        message: 'provider_continuations require ordered assistant_replay_parts',
      });
    }
    if (
      event.type === 'tool_call_decision'
      && event.payload?.provider_continuations?.length
      && !event.payload.assistant_replay_parts?.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payload', 'assistant_replay_parts'],
        message: 'provider_continuations require ordered assistant_replay_parts',
      });
    }
    if (event.type === 'tool_output') {
      if (event.status === 'success' && event.data === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['data'],
          message: 'successful tool_output requires data',
        });
      }
      if (event.status === 'success' && event.error !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['error'],
          message: 'successful tool_output must not contain error',
        });
      }
      if (event.status === 'success' && event.error_code !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['error_code'],
          message: 'successful tool_output must not contain error_code',
        });
      }
      if (event.status === 'error' && (!event.error || event.error.trim().length === 0)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['error'],
          message: 'failed tool_output requires error',
        });
      }
      if (event.status === 'error' && event.data !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['data'],
          message: 'failed tool_output must not contain data',
        });
      }
      return;
    }
    if (event.type === 'subrun_trace') {
      validateSubRunTracePayloadSemantics(event, ctx);
      return;
    }
    if (event.type === 'final_answer_chunk') {
      if (event.id === event.answer_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['id'],
          message: 'final_answer_chunk id must differ from answer_id',
        });
      }
      return;
    }
    if (event.type !== 'final_answer') return;
    if (event.id !== event.answer_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['id'],
        message: 'final_answer id must equal answer_id',
      });
    }
    const expectedComplete = event.completion_reason !== 'interrupted';
    if (event.is_complete !== expectedComplete) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['is_complete'],
        message: `final_answer completion_reason=${event.completion_reason} requires is_complete=${expectedComplete}`,
      });
    }
  });

export type RuntimeEvent = z.infer<typeof RuntimeEvent>;
/** 未经 admission 的 RuntimeEvent 输入；只允许传给会执行共享 schema parse 的边界。 */
export type RuntimeEventInput = z.input<typeof RuntimeEventShape>;
type WithRuntimeEventRoutingIdentity<T> = T extends RuntimeEvent
  ? T & RuntimeEventRoutingIdentity
  : never;
export type RoutedRuntimeEvent = WithRuntimeEventRoutingIdentity<RuntimeEvent>;
export type UserInputEvent = Extract<RuntimeEvent, { type: 'user_input' }>;
export type ThoughtEvent = Extract<RuntimeEvent, { type: 'thought' }>;
export type ToolCallDecisionEvent = Extract<RuntimeEvent, { type: 'tool_call_decision' }>;
export type ToolProcessEvent = Extract<RuntimeEvent, { type: 'tool_process' }>;
export type ToolOutputEvent = Extract<RuntimeEvent, { type: 'tool_output' }>;
export type ToolOutputEventResult =
  | { readonly status: 'success'; readonly observation: string; readonly data: unknown }
  | {
      readonly status: 'error';
      readonly observation: string;
      readonly error: string;
      readonly error_code?: string;
    };
export type SubRunTraceEvent = Extract<RuntimeEvent, { type: 'subrun_trace' }>;
export type RequiresUserInteractionEvent = Extract<
  RuntimeEvent,
  { type: 'requires_user_interaction' }
>;
export type AuditEnvelopeEvent = Extract<RuntimeEvent, { type: 'audit_envelope' }>;
export type FinalAnswerEvent = Extract<RuntimeEvent, { type: 'final_answer' }>;
export type FinalAnswerChunkEvent = Extract<RuntimeEvent, { type: 'final_answer_chunk' }>;
export type FinalAnswerResetEvent = Extract<RuntimeEvent, { type: 'final_answer_reset' }>;
export type HistorySummaryEvent = Extract<RuntimeEvent, { type: 'history_summary' }>;
export type ErrorEvent = Extract<RuntimeEvent, { type: 'error' }>;
export type ControlEvent = Extract<RuntimeEvent, { type: 'control' }>;
export type ContextUsageSnapshotEvent = Extract<
  RuntimeEvent,
  { type: 'context_usage_snapshot' }
>;
export type RunExecutionMetricsEvent = Extract<RuntimeEvent, { type: 'run_execution_metrics' }>;

export const validateRuntimeEvent = (event: unknown) => RuntimeEvent.safeParse(event);
export const validateRuntimeEvents = (events: unknown[]) => z.array(RuntimeEvent).safeParse(events);
export const parseRuntimeEvents = (events: unknown): RuntimeEvent[] =>
  z.array(RuntimeEvent).parse(events);

/**
 * 从完整 RuntimeEvent 读取正式路由身份。
 *
 * RuntimeEventRoutingIdentity 是 strict schema，不能直接 parse 带业务字段的完整事件；
 * 消费方必须通过这里显式选取顶层身份，禁止回退读取开放 metadata。
 */
export function parseRuntimeEventRoutingIdentity(
  event: Pick<RuntimeEventInput, 'run_id' | 'parent_run_id' | 'lane' | 'visibility'>
): RuntimeEventRoutingIdentity {
  return RuntimeEventRoutingIdentity.parse({
    run_id: event.run_id,
    parent_run_id: event.parent_run_id,
    lane: event.lane,
    visibility: event.visibility,
  });
}

/**
 * 把不可信输入解析为已经完成 run admission 的 RuntimeEvent。
 *
 * RuntimeEvent 允许事实在进入 execution publisher 前暂时没有路由身份；EventBus、
 * EventStore 和 replay 等下游边界只能接收这里返回的已路由事实。
 */
export function parseRoutedRuntimeEvent(value: unknown): RoutedRuntimeEvent {
  const event = RuntimeEvent.parse(value);
  const identity = parseRuntimeEventRoutingIdentity(event);
  return { ...event, ...identity };
}

/** 已通过普通 RuntimeEvent parse 的对象，在不复制 payload 的前提下检查 admission 身份。 */
export function isRoutedRuntimeEvent(event: RuntimeEvent): event is RoutedRuntimeEvent {
  return RuntimeEventRoutingIdentity.safeParse({
    run_id: event.run_id,
    parent_run_id: event.parent_run_id,
    lane: event.lane,
    visibility: event.visibility,
  }).success;
}

/**
 * 在 runtime/host 边界为事实附着正式路由身份，并执行共享 schema 校验。
 *
 * 返回新对象，避免 publisher 或 transport adapter 修改节点已经持有的 payload。
 */
export function routeRuntimeEvent(
  event: RuntimeEventInput,
  identity: z.input<typeof RuntimeEventRoutingIdentity>
): RoutedRuntimeEvent {
  return parseRoutedRuntimeEvent({
    ...event,
    ...RuntimeEventRoutingIdentity.parse(identity),
  });
}

type RuntimeEventCreatorBaseOwnedKey = 'type' | 'id' | 'conversation_id' | 'turn_id' | 'version';

/**
 * creator 参数拥有核心事实字段，options 只允许补充未被参数拥有的字段。
 * 对象构造仍会把参数字段放在 spread 之后，保证无类型检查的 JS 调用也不能覆盖身份。
 */
type RuntimeEventCreatorOptions<
  TEvent extends RuntimeEvent,
  TOwnedKey extends keyof TEvent = never,
> = Omit<Partial<TEvent>, RuntimeEventCreatorBaseOwnedKey | TOwnedKey>;

export const createUserInputEvent = (
  id: string,
  conversationId: string,
  turnId: string,
  content: string,
  options: RuntimeEventCreatorOptions<UserInputEvent, 'content'> = {}
): UserInputEvent => ({
  ...options,
  type: 'user_input',
  id,
  conversation_id: conversationId,
  turn_id: turnId,
  timestamp: options.timestamp ?? Date.now(),
  version: 1,
  content,
  source: options.source ?? 'user',
});

export const createThoughtEvent = (
  id: string,
  conversationId: string,
  turnId: string,
  content: string,
  options: RuntimeEventCreatorOptions<ThoughtEvent, 'content'> = {}
): ThoughtEvent => ({
  ...options,
  type: 'thought',
  id,
  conversation_id: conversationId,
  turn_id: turnId,
  timestamp: options.timestamp ?? Date.now(),
  version: 1,
  content,
  is_complete: options.is_complete ?? false,
});

export const createToolCallDecisionEvent = (
  id: string,
  conversationId: string,
  turnId: string,
  toolName: string,
  toolCallId: string,
  options: RuntimeEventCreatorOptions<ToolCallDecisionEvent, 'tool_name' | 'tool_call_id'> = {}
): ToolCallDecisionEvent => ({
  ...options,
  type: 'tool_call_decision',
  id,
  conversation_id: conversationId,
  turn_id: turnId,
  timestamp: options.timestamp ?? Date.now(),
  version: 1,
  tool_name: toolName,
  tool_call_id: ToolCallIdSchema.parse(toolCallId),
  phase: options.phase ?? 'start',
  status: options.status ?? 'loading',
});

export const createToolProcessEvent = (
  id: string,
  conversationId: string,
  turnId: string,
  toolName: string,
  toolCallId: string,
  options: RuntimeEventCreatorOptions<ToolProcessEvent, 'tool_name' | 'tool_call_id'> = {}
): ToolProcessEvent => ({
  ...options,
  type: 'tool_process',
  id,
  conversation_id: conversationId,
  turn_id: turnId,
  timestamp: options.timestamp ?? Date.now(),
  version: 1,
  tool_name: toolName,
  tool_call_id: ToolCallIdSchema.parse(toolCallId),
  phase: options.phase ?? 'start',
  status: options.status ?? 'loading',
});

export const createSubRunTraceEvent = (
  id: string,
  conversationId: string,
  turnId: string,
  parentToolCallId: string,
  subrunId: string,
  kind: SubRunTraceEvent['kind'],
  options: RuntimeEventCreatorOptions<
    SubRunTraceEvent,
    'parent_tool_call_id' | 'subrun_id' | 'kind'
  > &
    Pick<SubRunTraceEvent, 'source_event_id'>
): SubRunTraceEvent => ({
  ...options,
  type: 'subrun_trace',
  id,
  conversation_id: conversationId,
  turn_id: turnId,
  timestamp: options.timestamp ?? Date.now(),
  version: 1,
  ephemeral: options.ephemeral ?? true,
  parent_tool_call_id: ToolCallIdSchema.parse(parentToolCallId),
  subrun_id: subrunId,
  kind,
});

export const createRequiresUserInteractionEvent = (
  id: string,
  conversationId: string,
  turnId: string,
  options: RuntimeEventCreatorOptions<RequiresUserInteractionEvent> &
    Pick<
      RequiresUserInteractionEvent,
      | 'interaction_id'
      | 'run_id'
      | 'tool_call_id'
      | 'checkpoint_revision'
      | 'resume_token'
      | 'interaction_status'
    >
): RequiresUserInteractionEvent => ({
  ...options,
  type: 'requires_user_interaction',
  id,
  conversation_id: conversationId,
  turn_id: turnId,
  timestamp: options.timestamp ?? Date.now(),
  version: 1,
});

export const createToolOutputEvent = (
  id: string,
  conversationId: string,
  turnId: string,
  toolName: string,
  toolCallId: string,
  result: ToolOutputEventResult,
  options: RuntimeEventCreatorOptions<
    ToolOutputEvent,
    'tool_name' | 'tool_call_id' | 'status' | 'observation' | 'data' | 'error' | 'error_code'
  > = {}
): ToolOutputEvent => {
  const event = {
    ...options,
    type: 'tool_output' as const,
    id,
    conversation_id: conversationId,
    turn_id: turnId,
    timestamp: options.timestamp ?? Date.now(),
    version: 1 as const,
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
  };
  const parsed = RuntimeEvent.parse(event);
  if (parsed.type !== 'tool_output') {
    throw new Error('createToolOutputEvent produced an invalid event type');
  }
  return parsed;
};

export const createFinalAnswerEvent = (
  answerId: string,
  conversationId: string,
  turnId: string,
  content: string,
  options: RuntimeEventCreatorOptions<
    FinalAnswerEvent,
    'answer_id' | 'content' | 'completion_reason' | 'is_complete'
  > &
    Pick<FinalAnswerEvent, 'completion_reason'>
): FinalAnswerEvent => ({
  // options 只承载路由、时间等附加字段；核心身份放在 spread 之后，防止 JS 调用方绕过 TS 签名覆盖。
  ...options,
  type: 'final_answer',
  id: answerId,
  conversation_id: conversationId,
  turn_id: turnId,
  timestamp: options.timestamp ?? Date.now(),
  version: 1,
  answer_id: answerId,
  content,
  completion_reason: options.completion_reason,
  is_complete: options.completion_reason !== 'interrupted',
});

export const createAuditEnvelopeEvent = (
  id: string,
  conversationId: string,
  turnId: string,
  envelope: AuditEnvelopeEvent['envelope'],
  options: RuntimeEventCreatorOptions<AuditEnvelopeEvent, 'envelope'> = {}
): AuditEnvelopeEvent => ({
  ...options,
  type: 'audit_envelope',
  id,
  conversation_id: conversationId,
  turn_id: turnId,
  timestamp: options.timestamp ?? envelope.ts,
  version: 1,
  envelope,
});

export const createFinalAnswerChunkEvent = (
  id: string,
  conversationId: string,
  turnId: string,
  answerId: string,
  seq: number,
  content: string,
  options: RuntimeEventCreatorOptions<FinalAnswerChunkEvent, 'answer_id' | 'seq' | 'content'> = {}
): FinalAnswerChunkEvent => ({
  // 与 seal creator 一致：附加字段先展开，creator 拥有的身份与正文随后锁定。
  ...options,
  type: 'final_answer_chunk',
  id,
  conversation_id: conversationId,
  turn_id: turnId,
  timestamp: options.timestamp ?? Date.now(),
  version: 1,
  answer_id: answerId,
  seq,
  content,
});

export const createFinalAnswerResetEvent = (
  id: string,
  conversationId: string,
  turnId: string,
  options: RuntimeEventCreatorOptions<FinalAnswerResetEvent> = {}
): FinalAnswerResetEvent => ({
  ...options,
  type: 'final_answer_reset',
  id,
  conversation_id: conversationId,
  turn_id: turnId,
  timestamp: options.timestamp ?? Date.now(),
  version: 1,
  ephemeral: options.ephemeral ?? true,
});

export const createHistorySummaryEvent = (
  id: string,
  conversationId: string,
  turnId: string,
  content: string,
  replacedMessageIds: string[],
  originalMessageCount: number,
  summarySeq: number,
  options: RuntimeEventCreatorOptions<
    HistorySummaryEvent,
    'content' | 'replaced_message_ids' | 'original_message_count' | 'summary_seq'
  > = {}
): HistorySummaryEvent => ({
  ...options,
  type: 'history_summary',
  id,
  conversation_id: conversationId,
  turn_id: turnId,
  timestamp: options.timestamp ?? Date.now(),
  version: 1,
  content,
  replaced_message_ids: replacedMessageIds,
  original_message_count: originalMessageCount,
  summary_seq: summarySeq,
});

export const createErrorEvent = (
  id: string,
  conversationId: string,
  turnId: string,
  error: string,
  options: RuntimeEventCreatorOptions<ErrorEvent, 'error'> = {}
): ErrorEvent => ({
  ...options,
  type: 'error',
  id,
  conversation_id: conversationId,
  turn_id: turnId,
  timestamp: options.timestamp ?? Date.now(),
  version: 1,
  error,
});

export const createContextUsageSnapshotEvent = (
  id: string,
  conversationId: string,
  turnId: string,
  contextUsage: ContextUsageSnapshotEvent['context_usage'],
  options: RuntimeEventCreatorOptions<ContextUsageSnapshotEvent, 'context_usage'> = {}
): ContextUsageSnapshotEvent => ({
  ...options,
  type: 'context_usage_snapshot',
  id,
  conversation_id: conversationId,
  turn_id: turnId,
  timestamp: options.timestamp ?? Date.now(),
  version: 1,
  ephemeral: true,
  context_usage: contextUsage,
});

export const createRunExecutionMetricsEvent = (
  id: string,
  conversationId: string,
  turnId: string,
  options: RuntimeEventCreatorOptions<RunExecutionMetricsEvent> &
    Pick<RunExecutionMetricsEvent, 'execution_id' | 'outcome' | 'duration_ms'>
): RunExecutionMetricsEvent => ({
  ...options,
  type: 'run_execution_metrics',
  id,
  conversation_id: conversationId,
  turn_id: turnId,
  timestamp: options.timestamp ?? Date.now(),
  version: 1,
});
