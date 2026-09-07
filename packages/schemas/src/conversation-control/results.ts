import { z } from 'zod';
import { JsonValueSchema } from '../json-value';
import { ConversationHistoryListItemSchema } from '../conversation/history';
import { ConversationUiMessageSchema } from '../conversation/ui-message';
import { ModelPickerReasoningSchema } from '../model-picker';
import { CONVERSATION_CONTROL_SCHEMA_VERSION } from './protocol';
import { ConversationControlWorkspaceToolNameSchema } from './commands';

const SuccessBaseFields = {
  schema_version: z.literal(CONVERSATION_CONTROL_SCHEMA_VERSION),
  ok: z.literal(true),
} as const;

const OpaqueIdSchema = z.string().trim().min(1);

export const ConversationControlAcceptedReceiptSchema = z
  .object({
    conversation_id: OpaqueIdSchema,
    user_message_id: OpaqueIdSchema,
    turn_id: OpaqueIdSchema,
    run_id: OpaqueIdSchema,
    execution_id: OpaqueIdSchema,
    agent_id: OpaqueIdSchema,
    accepted_at: z.number().finite().nonnegative(),
  })
  .strict();

export type ConversationControlAcceptedReceipt = z.infer<
  typeof ConversationControlAcceptedReceiptSchema
>;

export const ConversationControlSendResponseSchema = z
  .object({
    ...SuccessBaseFields,
    command: z.literal('send'),
    receipt: ConversationControlAcceptedReceiptSchema,
  })
  .strict();

const ConversationControlModelUnavailableReasonSchema = z.enum([
  'capability_missing',
  'route_missing',
  'credential_missing',
]);

const ConversationControlModelSummaryBaseFields = {
  model_config_id: OpaqueIdSchema,
  model_name: OpaqueIdSchema,
  display_name: OpaqueIdSchema,
  catalog_source: z.enum(['default', 'cloud', 'account', 'user']),
  input_support: z
    .object({
      user_image: z.boolean(),
      tool_result_image: z.boolean(),
    })
    .strict()
    .optional(),
  reasoning: ModelPickerReasoningSchema.optional(),
} as const;

export const ConversationControlModelSummarySchema = z.discriminatedUnion('available', [
  z.object({ ...ConversationControlModelSummaryBaseFields, available: z.literal(true) }).strict(),
  z
    .object({
      ...ConversationControlModelSummaryBaseFields,
      available: z.literal(false),
      unavailable_reason: ConversationControlModelUnavailableReasonSchema,
    })
    .strict(),
]);

export const ConversationControlModelsResponseSchema = z
  .object({
    ...SuccessBaseFields,
    command: z.literal('models'),
    chat: z.array(ConversationControlModelSummarySchema),
    image_generation: z.array(ConversationControlModelSummarySchema),
  })
  .strict();

export const ConversationControlListResponseSchema = z
  .object({
    ...SuccessBaseFields,
    command: z.literal('list'),
    conversations: z.array(ConversationHistoryListItemSchema),
    next_cursor: OpaqueIdSchema.optional(),
    has_more: z.boolean(),
  })
  .strict();

const MessagesWindowFields = {
  ...SuccessBaseFields,
  command: z.literal('messages'),
  conversation_id: OpaqueIdSchema,
} as const;

export const ConversationControlMessagesResponseSchema = z.discriminatedUnion('status', [
  z
    .object({
      ...MessagesWindowFields,
      status: z.literal('ready'),
      messages: z.array(ConversationUiMessageSchema),
      has_more_before: z.boolean(),
      has_more_after: z.boolean(),
      prev_cursor: z.number().int().positive().optional(),
      next_cursor: z.number().int().positive().optional(),
      revision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      ...MessagesWindowFields,
      status: z.literal('preparing'),
    })
    .strict(),
]);

export const ConversationControlRunStatusSchema = z.enum([
  'pending',
  'running',
  'awaiting_user',
  'completed',
  'failed',
  'cancelled',
]);

export const ConversationControlPendingInteractionSchema = z
  .object({
    interaction_id: OpaqueIdSchema,
    tool_name: OpaqueIdSchema,
    prompt: z.string().optional(),
    form: JsonValueSchema.optional(),
  })
  .strict();

export const ConversationControlRunStatusSnapshotSchema = z
  .object({
    conversation_id: OpaqueIdSchema,
    run_id: OpaqueIdSchema,
    turn_id: OpaqueIdSchema,
    execution_id: OpaqueIdSchema,
    agent_id: OpaqueIdSchema,
    status: ConversationControlRunStatusSchema,
    current_node: z.string().trim().min(1).optional(),
    execution_steps_used: z.number().int().nonnegative().optional(),
    run_iterations_used: z.number().int().nonnegative().optional(),
    iterations_used: z.number().int().nonnegative().optional(),
    started_at: z.number().finite().nonnegative(),
    updated_at: z.number().finite().nonnegative(),
    terminal_at: z.number().finite().nonnegative().optional(),
    pending_interaction: ConversationControlPendingInteractionSchema.optional(),
    result_available: z.boolean(),
    error: z
      .object({
        code: OpaqueIdSchema,
        message: z.string(),
        recoverable: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ConversationControlRunStatusSnapshot = z.infer<
  typeof ConversationControlRunStatusSnapshotSchema
>;

export const ConversationControlStatusResponseSchema = z
  .object({
    ...SuccessBaseFields,
    command: z.literal('status'),
    conversation_id: OpaqueIdSchema,
    run: ConversationControlRunStatusSnapshotSchema.nullable(),
  })
  .strict();

export const ConversationControlProgressFrameSchema = z
  .object({
    schema_version: z.literal(CONVERSATION_CONTROL_SCHEMA_VERSION),
    frame: z.literal('status'),
    sequence: z.number().int().nonnegative(),
    observed_at: z.number().finite().nonnegative(),
    snapshot: ConversationControlRunStatusSnapshotSchema.nullable(),
  })
  .strict();

export const ConversationControlRespondResponseSchema = z
  .object({
    ...SuccessBaseFields,
    command: z.literal('respond'),
    receipt: ConversationControlAcceptedReceiptSchema.omit({ user_message_id: true }).extend({
      interaction_id: OpaqueIdSchema,
    }).strict(),
  })
  .strict();

export const ConversationControlStopResponseSchema = z
  .object({
    ...SuccessBaseFields,
    command: z.literal('stop'),
    conversation_id: OpaqueIdSchema,
    run_id: OpaqueIdSchema,
    requested_reason: z.string().trim().min(1),
    outcome: z.enum(['cancelled', 'completed', 'failed']),
    completed_at: z.number().finite().nonnegative(),
  })
  .strict();

const ResultResponseFields = {
  ...SuccessBaseFields,
  command: z.literal('result'),
  conversation_id: OpaqueIdSchema,
  run_id: OpaqueIdSchema,
  outcome: z.enum(['completed', 'failed', 'cancelled']),
  completed_at: z.number().finite().nonnegative(),
} as const;

export const ConversationControlResultResponseSchema = z.discriminatedUnion('result_status', [
  z
    .object({
      ...ResultResponseFields,
      result_status: z.literal('available'),
      message: ConversationUiMessageSchema.refine(
        message => message.message_type === 'final_answer',
        'result message must be a final_answer',
      ),
    })
    .strict(),
  z
    .object({
      ...ResultResponseFields,
      result_status: z.literal('unavailable'),
      reason: z.enum(['run_not_completed', 'final_answer_missing', 'projection_preparing']),
    })
    .strict(),
]);

export const ConversationControlWorkspaceToolSummarySchema = z.object({
  name: ConversationControlWorkspaceToolNameSchema,
  description: z.string().trim().min(1),
}).strict();

export const ConversationControlWorkspaceToolDescriptorSchema =
  ConversationControlWorkspaceToolSummarySchema
    .extend({ parameters: JsonValueSchema })
    .strict();

const WorkspaceToolsResponseBaseFields = {
  ...SuccessBaseFields,
  command: z.literal('workspace_tools'),
} as const;

export const ConversationControlWorkspaceToolsResponseSchema = z.discriminatedUnion('action', [
  z.object({
    ...WorkspaceToolsResponseBaseFields,
    action: z.literal('list'),
    tools: z.array(ConversationControlWorkspaceToolSummarySchema),
  }).strict(),
  z.object({
    ...WorkspaceToolsResponseBaseFields,
    action: z.literal('describe'),
    tool: ConversationControlWorkspaceToolDescriptorSchema,
  }).strict(),
  z.object({
    ...WorkspaceToolsResponseBaseFields,
    action: z.literal('call'),
    tool_name: ConversationControlWorkspaceToolNameSchema,
    receipt: ConversationControlAcceptedReceiptSchema,
  }).strict(),
]);

const ConversationControlAuditTokenTotalsSchema = z
  .object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    total_tokens_reported: z.number().int().nonnegative().optional(),
    reasoning_tokens_reported: z.number().int().nonnegative().optional(),
    cache_read_tokens_reported: z.number().int().nonnegative().optional(),
    cache_write_tokens_reported: z.number().int().nonnegative().optional(),
  })
  .strict();

const ConversationControlAuditUsageSchema = ConversationControlAuditTokenTotalsSchema.extend({
  confidence: z.enum(['estimate', 'provider-estimate', 'actual']),
}).strict();

const ConversationControlAuditModelSummarySchema = z
  .object({
    model_id: OpaqueIdSchema,
    calls: z.number().int().nonnegative(),
    duration_ms: z.number().int().nonnegative(),
    provider_actual_calls: z.number().int().nonnegative(),
    estimate_calls: z.number().int().nonnegative(),
    missing_usage_calls: z.number().int().nonnegative(),
    actual_tokens: ConversationControlAuditTokenTotalsSchema,
  })
  .strict();

const ConversationControlAuditToolSummarySchema = z
  .object({
    tool_name: OpaqueIdSchema,
    calls: z.number().int().nonnegative(),
    failed_calls: z.number().int().nonnegative(),
    duration_ms: z.number().int().nonnegative(),
    error_codes: z.array(OpaqueIdSchema),
  })
  .strict();

const ConversationControlAuditCompactionOutcomeSchema = z.enum([
  'skipped',
  'completed',
  'failed',
  'insufficient',
  'aborted',
]);

const ConversationControlAuditCompactionEventSchema = z
  .object({
    emitted_at: z.number().finite().nonnegative(),
    model_id: OpaqueIdSchema,
    compaction_index: z.number().int().positive(),
    max_compactions_per_run: z.number().int().positive(),
    generation_attempted: z.boolean(),
    trigger_ratio: z.number().min(0).max(1),
    target_ratio: z.number().min(0).max(1),
    before_tokens: z.number().int().nonnegative(),
    input_budget_tokens: z.number().int().nonnegative(),
    compaction_input_tokens: z.number().int().nonnegative().optional(),
    after_tokens: z.number().int().nonnegative().optional(),
    replaced_message_count: z.number().int().nonnegative(),
    replaced_tool_group_count: z.number().int().nonnegative(),
    kept_tool_group_count: z.number().int().nonnegative(),
    summary_output_tokens: z.number().int().nonnegative().optional(),
    /** 原始摘要 / 被替换区段 token 比率；无效压缩可大于等于 1。 */
    compression_ratio: z.number().nonnegative().optional(),
    usage: ConversationControlAuditUsageSchema.optional(),
    duration_ms: z.number().int().nonnegative(),
    outcome: ConversationControlAuditCompactionOutcomeSchema,
    suppressed_reason: OpaqueIdSchema.optional(),
    forced_phase_recovery: z.boolean(),
    target_unreachable: z.boolean().optional(),
    error_code: OpaqueIdSchema.optional(),
    failure_reason: OpaqueIdSchema.optional(),
  })
  .strict();

const ConversationControlAuditCompactionRunSchema = z
  .object({
    run_id: OpaqueIdSchema,
    parent_run_id: OpaqueIdSchema.optional(),
    observations: z.number().int().nonnegative(),
    attempts: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    insufficient: z.number().int().nonnegative(),
    aborted: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    duration_ms: z.number().int().nonnegative(),
    max_compactions_per_run: z.number().int().positive(),
    compaction_input_tokens_reported: z.number().int().nonnegative().optional(),
    summary_output_tokens_reported: z.number().int().nonnegative().optional(),
    released_tokens_reported: z.number().int().nonnegative().optional(),
    provider_actual_calls: z.number().int().nonnegative(),
    estimate_calls: z.number().int().nonnegative(),
    missing_usage_calls: z.number().int().nonnegative(),
    actual_tokens: ConversationControlAuditTokenTotalsSchema,
    events: z.array(ConversationControlAuditCompactionEventSchema),
  })
  .strict();

const ConversationControlAuditRunTerminalReasonSchema = z.enum([
  'completed',
  'awaiting_user',
  'step_budget_forced_completion',
  'step_budget_exhausted',
  'capacity_failed',
  'failed',
  'cancelled',
]);

const ConversationControlAuditRunLifecycleSchema = z
  .object({
    run_id: OpaqueIdSchema,
    parent_run_id: OpaqueIdSchema.optional(),
    terminal_observations: z.number().int().positive(),
    phase: z.enum(['completed', 'failed', 'cancelled']),
    steps_used: z.number().int().nonnegative(),
    max_steps: z.number().int().positive(),
    terminal_reason: ConversationControlAuditRunTerminalReasonSchema,
    emitted_at: z.number().finite().nonnegative(),
  })
  .strict();

const ConversationControlAuditRunSchema = z
  .object({
    run_id: OpaqueIdSchema,
    parent_run_id: OpaqueIdSchema.optional(),
    agent_id: OpaqueIdSchema.optional(),
    status: z.enum([
      'pending',
      'running',
      'awaiting_user',
      'paused',
      'completed',
      'failed',
      'cancelled',
    ]),
    started_at: z.number().finite().nonnegative(),
    updated_at: z.number().finite().nonnegative(),
    execution_steps_used: z.number().int().nonnegative().optional(),
    run_iterations_used: z.number().int().nonnegative().optional(),
    iterations_used: z.number().int().nonnegative().optional(),
    error_code: OpaqueIdSchema.optional(),
  })
  .strict();

const ConversationControlAuditToolPairingRecordSchema = z
  .object({
    run_id: OpaqueIdSchema,
    parent_run_id: OpaqueIdSchema.optional(),
    tool_call_id: OpaqueIdSchema,
    tool_name: OpaqueIdSchema,
    pairing_status: z.enum([
      'paired',
      'decision_missing',
      'terminal_missing',
      'duplicate_terminal',
    ]),
    decision_count: z.number().int().nonnegative(),
    terminal_count: z.number().int().nonnegative(),
    terminal_status: z.enum(['success', 'error']).optional(),
    name_consistent: z.boolean(),
  })
  .strict();

const ConversationControlAuditCommandProcessExitSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('not_started') }).strict(),
  z.object({
    status: z.literal('observed'),
    exit_code: z.number().int().safe().nullable(),
    signal: z.string().min(1).nullable(),
  }).strict(),
  z.object({
    status: z.literal('unavailable'),
    reason: z.enum(['runtime_lost', 'platform_not_reported']),
  }).strict(),
]);

const ConversationControlAuditCommandTerminalFields = {
    run_id: OpaqueIdSchema,
    tool_call_id: OpaqueIdSchema,
    command_execution_id: OpaqueIdSchema,
    terminal_observations: z.number().int().positive(),
    process_exit: ConversationControlAuditCommandProcessExitSchema,
    emitted_at: z.number().finite().nonnegative(),
} as const;

const ConversationControlAuditCommandTerminalSchema = z.discriminatedUnion('outcome', [
  z.object({
    ...ConversationControlAuditCommandTerminalFields,
    outcome: z.literal('execution_ended'),
    termination_cause: z.enum([
      'natural_exit',
      'user_cancelled',
      'hard_timeout',
      'owner_ended',
    ]),
  }).strict(),
  z.object({
    ...ConversationControlAuditCommandTerminalFields,
    outcome: z.literal('runtime_failure'),
    runtime_failure_code: OpaqueIdSchema,
  }).strict(),
]);

export const ConversationControlAuditResponseSchema = z
  .object({
    ...SuccessBaseFields,
    command: z.literal('audit'),
    conversation_id: OpaqueIdSchema,
    requested_run_id: OpaqueIdSchema.optional(),
    generated_at: z.number().finite().nonnegative(),
    completeness: z
      .object({
        run_registry: z.literal('complete'),
        event_store: z.literal('complete'),
        telemetry: z.literal('best_effort'),
        telemetry_retention_days: z.number().int().positive(),
      })
      .strict(),
    source_window: z
      .object({
        telemetry_events: z.number().int().nonnegative(),
        event_facts: z.number().int().nonnegative(),
        earliest_telemetry_at: z.number().finite().nonnegative().optional(),
        latest_telemetry_at: z.number().finite().nonnegative().optional(),
      })
      .strict(),
    runs: z.array(ConversationControlAuditRunSchema),
    llm: z
      .object({
        calls: z.number().int().nonnegative(),
        duration_ms: z.number().int().nonnegative(),
        provider_actual_calls: z.number().int().nonnegative(),
        estimate_calls: z.number().int().nonnegative(),
        missing_usage_calls: z.number().int().nonnegative(),
        actual_tokens: ConversationControlAuditTokenTotalsSchema,
        by_model: z.array(ConversationControlAuditModelSummarySchema),
      })
      .strict(),
    tools: z
      .object({
        calls: z.number().int().nonnegative(),
        failed_calls: z.number().int().nonnegative(),
        duration_ms: z.number().int().nonnegative(),
        by_tool: z.array(ConversationControlAuditToolSummarySchema),
      })
      .strict(),
    tool_pairing: z
      .object({
        complete: z.boolean(),
        paired: z.number().int().nonnegative(),
        decision_missing: z.number().int().nonnegative(),
        terminal_missing: z.number().int().nonnegative(),
        duplicate_terminal: z.number().int().nonnegative(),
        name_mismatches: z.number().int().nonnegative(),
        records: z.array(ConversationControlAuditToolPairingRecordSchema),
      })
      .strict(),
    commands: z
      .object({
        executions: z.number().int().nonnegative(),
        terminal_observations: z.number().int().nonnegative(),
        nonzero_exit_executions: z.number().int().nonnegative(),
        runtime_failure_executions: z.number().int().nonnegative(),
        by_execution: z.array(ConversationControlAuditCommandTerminalSchema),
      })
      .strict(),
    context_compaction: z
      .object({
        observations: z.number().int().nonnegative(),
        attempts: z.number().int().nonnegative(),
        completed: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        insufficient: z.number().int().nonnegative(),
        aborted: z.number().int().nonnegative(),
        skipped: z.number().int().nonnegative(),
        duration_ms: z.number().int().nonnegative(),
        compaction_input_tokens_reported: z.number().int().nonnegative().optional(),
        summary_output_tokens_reported: z.number().int().nonnegative().optional(),
        released_tokens_reported: z.number().int().nonnegative().optional(),
        provider_actual_calls: z.number().int().nonnegative(),
        estimate_calls: z.number().int().nonnegative(),
        missing_usage_calls: z.number().int().nonnegative(),
        actual_tokens: ConversationControlAuditTokenTotalsSchema,
        by_run: z.array(ConversationControlAuditCompactionRunSchema),
      })
      .strict(),
    run_lifecycle: z
      .object({
        by_run: z.array(ConversationControlAuditRunLifecycleSchema),
      })
      .strict(),
  })
  .strict();

export const ConversationControlErrorCodeSchema = z.enum([
  'invalid_request',
  'app_not_running',
  'stale_connection',
  'protocol_incompatible',
  'unauthorized',
  'capability_unavailable',
  'conversation_busy',
  'no_active_run',
  'run_not_found',
  'run_mismatch',
  'interaction_mismatch',
  'result_unavailable',
  'unsupported_runtime_state',
  'transport_failure',
  'internal_error',
]);

export type ConversationControlErrorCode = z.infer<
  typeof ConversationControlErrorCodeSchema
>;

export const ConversationControlErrorResponseSchema = z
  .object({
    schema_version: z.literal(CONVERSATION_CONTROL_SCHEMA_VERSION),
    ok: z.literal(false),
    command: z.enum([
      'send',
      'models',
      'list',
      'messages',
      'status',
      'respond',
      'stop',
      'result',
      'audit',
      'workspace_tools',
    ]).optional(),
    error: z
      .object({
        code: ConversationControlErrorCodeSchema,
        message: z.string().trim().min(1),
        retryable: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const ConversationControlCommandResponseSchema = z.union([
  ConversationControlSendResponseSchema,
  ConversationControlModelsResponseSchema,
  ConversationControlListResponseSchema,
  ConversationControlMessagesResponseSchema,
  ConversationControlStatusResponseSchema,
  ConversationControlRespondResponseSchema,
  ConversationControlStopResponseSchema,
  ConversationControlResultResponseSchema,
  ConversationControlAuditResponseSchema,
  ConversationControlWorkspaceToolsResponseSchema,
  ConversationControlErrorResponseSchema,
]);

export type ConversationControlSendResponse = z.infer<
  typeof ConversationControlSendResponseSchema
>;
export type ConversationControlModelSummary = z.infer<
  typeof ConversationControlModelSummarySchema
>;
export type ConversationControlModelsResponse = z.infer<
  typeof ConversationControlModelsResponseSchema
>;
export type ConversationControlListResponse = z.infer<
  typeof ConversationControlListResponseSchema
>;
export type ConversationControlMessagesResponse = z.infer<
  typeof ConversationControlMessagesResponseSchema
>;
export type ConversationControlStatusResponse = z.infer<
  typeof ConversationControlStatusResponseSchema
>;
export type ConversationControlProgressFrame = z.infer<
  typeof ConversationControlProgressFrameSchema
>;
export type ConversationControlRespondResponse = z.infer<
  typeof ConversationControlRespondResponseSchema
>;
export type ConversationControlStopResponse = z.infer<
  typeof ConversationControlStopResponseSchema
>;
export type ConversationControlResultResponse = z.infer<
  typeof ConversationControlResultResponseSchema
>;
export type ConversationControlAuditResponse = z.infer<
  typeof ConversationControlAuditResponseSchema
>;
export type ConversationControlWorkspaceToolDescriptor = z.infer<
  typeof ConversationControlWorkspaceToolDescriptorSchema
>;
export type ConversationControlWorkspaceToolSummary = z.infer<
  typeof ConversationControlWorkspaceToolSummarySchema
>;
export type ConversationControlWorkspaceToolsResponse = z.infer<
  typeof ConversationControlWorkspaceToolsResponseSchema
>;
export type ConversationControlErrorResponse = z.infer<
  typeof ConversationControlErrorResponseSchema
>;
export type ConversationControlCommandResponse = z.infer<
  typeof ConversationControlCommandResponseSchema
>;
