import { z } from 'zod';

import {
  CommandApprovalRequestIdSchema,
  CommandApprovalSettlementV1Schema,
  CommandExecutionIdentitySchema,
  CommandExecutionModeSchema,
  CommandExecutionOwnerBindingV1Schema,
  CommandExecutionTerminalV1Schema,
  CommandPermissionSnapshotV1Schema,
  CommandProcessHandleSchema,
  CommandControlToolCallIdSchema,
  CommandInvocationProfileIdSchema,
  CommandOutputTextEncodingSchema,
  CommandRuntimePlatformSchema,
  MAX_PROCESS_INTERACTION_INPUT_BYTES,
  MAX_PROCESS_OUTPUT_WAIT_TIMEOUT_MS,
  MAX_PROCESS_PTY_DIMENSION,
  ProcessControlRejectionCodeSchema,
  ProcessOutputCursorSchema,
  hasSameCommandExecutionIdentity,
  ShellCommandProposalV1Schema,
} from '@app/schemas/commands';

const OccurredAtMsSchema = z.number().int().nonnegative().safe();

const SafeRuntimeStringSchema = z.string().min(1).refine(
  value => !value.includes('\0'),
  'command audit runtime strings must not contain NUL',
);

/**
 * 这里只保留可长期解释的 Shell 来源，不接受 launch argv 或 environment。
 * executable_path 是 host 已冻结的实际启动来源，不根据命令文字或进程列表反推。
 */
export const CommandExecutionAuditRuntimeSummarySchema = z.object({
  platform: CommandRuntimePlatformSchema,
  shell_semantics_id: z.string().min(1).max(128),
  shell_version: SafeRuntimeStringSchema,
  snapshot_revision: SafeRuntimeStringSchema,
  output_text_encoding: CommandOutputTextEncodingSchema,
  command_invocation_profile_id: CommandInvocationProfileIdSchema,
  executable_path: SafeRuntimeStringSchema,
  hard_timeout_ms: z.number().int().positive().safe(),
}).strict();
export type CommandExecutionAuditRuntimeSummary = z.infer<
  typeof CommandExecutionAuditRuntimeSummarySchema
>;

const CommandAuthorizationSettlementSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('authorized'),
    permission: CommandPermissionSnapshotV1Schema,
    approval_request_id: CommandApprovalRequestIdSchema.optional(),
  }).strict(),
  z.object({
    outcome: z.literal('rejected'),
    code: z.enum(['approval_denied', 'permission_unavailable']),
    approval_request_id: CommandApprovalRequestIdSchema.optional(),
  }).strict(),
]);

function hasSamePermissionSnapshot(
  left: z.infer<typeof CommandPermissionSnapshotV1Schema>,
  right: z.infer<typeof CommandPermissionSnapshotV1Schema>,
): boolean {
  return hasSameCommandExecutionIdentity(left.identity, right.identity)
    && left.base_level === right.base_level
    && left.effective_level === right.effective_level
    && left.grant_source === right.grant_source
    && left.internal_data_access === right.internal_data_access;
}

const CommandProcessActionSummarySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('poll'),
    cursor: ProcessOutputCursorSchema,
  }).strict(),
  z.object({
    type: z.literal('wait'),
    cursor: ProcessOutputCursorSchema,
    wait_timeout_ms: z.number().int().positive()
      .max(MAX_PROCESS_OUTPUT_WAIT_TIMEOUT_MS),
  }).strict(),
  z.object({ type: z.literal('cancel') }).strict(),
  z.object({
    type: z.literal('write'),
    input_bytes: z.number().int().positive()
      .max(MAX_PROCESS_INTERACTION_INPUT_BYTES),
  }).strict(),
  z.object({
    type: z.literal('submit'),
    input_bytes: z.number().int().nonnegative()
      .max(MAX_PROCESS_INTERACTION_INPUT_BYTES),
  }).strict(),
  z.object({ type: z.literal('eof') }).strict(),
  z.object({
    type: z.literal('resize'),
    columns: z.number().int().positive().max(MAX_PROCESS_PTY_DIMENSION),
    rows: z.number().int().positive().max(MAX_PROCESS_PTY_DIMENSION),
  }).strict(),
]);

const CommandProcessActionResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('running') }).strict(),
  z.object({ status: z.literal('completed') }).strict(),
  z.object({ status: z.literal('accepted') }).strict(),
  z.object({
    status: z.literal('rejected'),
    code: ProcessControlRejectionCodeSchema,
  }).strict(),
]);

const CommandProposalCreatedAuditEventSchema = z.object({
  kind: z.literal('proposal_created'),
  occurred_at_ms: OccurredAtMsSchema,
  proposal: ShellCommandProposalV1Schema,
  binding: CommandExecutionOwnerBindingV1Schema.optional(),
}).strict().superRefine((event, context) => {
  if (
    event.binding
    && !hasSameCommandExecutionIdentity(event.proposal.identity, event.binding.identity)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['binding', 'identity'],
      message: 'proposal binding must belong to the audited command execution',
    });
  }
});

const CommandAuthorizationSettledAuditEventSchema = z.object({
  kind: z.literal('authorization_settled'),
  occurred_at_ms: OccurredAtMsSchema,
  identity: CommandExecutionIdentitySchema,
  settlement: CommandAuthorizationSettlementSchema,
  approval_settlement: CommandApprovalSettlementV1Schema.optional(),
}).strict().superRefine((event, context) => {
  if (
    event.settlement.outcome === 'authorized'
    && !hasSameCommandExecutionIdentity(event.identity, event.settlement.permission.identity)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['settlement', 'permission', 'identity'],
      message: 'authorization permission must belong to the audited command execution',
    });
  }
  if (
    event.approval_settlement
    && !hasSameCommandExecutionIdentity(
      event.identity,
      event.approval_settlement.proposal_identity,
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['approval_settlement', 'proposal_identity'],
      message: 'approval settlement must belong to the audited command execution',
    });
  }
  if (
    event.approval_settlement
    && event.settlement.approval_request_id
    && event.approval_settlement.approval_request_id
      !== event.settlement.approval_request_id
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['approval_settlement', 'approval_request_id'],
      message: 'approval settlement must match the referenced approval request',
    });
  }
  if (
    event.approval_settlement
    && event.settlement.outcome === 'authorized'
    && event.approval_settlement.outcome !== 'approved'
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['approval_settlement', 'outcome'],
      message: 'an authorized command cannot reference a non-approved settlement',
    });
  }
  if (
    event.approval_settlement?.outcome === 'approved'
    && event.settlement.outcome !== 'authorized'
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['settlement', 'outcome'],
      message: 'an approved settlement must produce an authorized command',
    });
  }
  if (
    event.approval_settlement?.outcome === 'approved'
    && event.settlement.outcome === 'authorized'
    && !hasSamePermissionSnapshot(
      event.approval_settlement.permission,
      event.settlement.permission,
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['settlement', 'permission'],
      message: 'authorization permission must match the approved settlement',
    });
  }
  if (
    event.approval_settlement?.outcome === 'rejected'
    && !(
      event.settlement.outcome === 'rejected'
      && event.settlement.code === 'approval_denied'
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['settlement'],
      message: 'a user-rejected settlement must produce approval_denied',
    });
  }
  if (
    event.approval_settlement
    && ['invalidated', 'failed'].includes(event.approval_settlement.outcome)
    && !(
      event.settlement.outcome === 'rejected'
      && event.settlement.code === 'permission_unavailable'
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['settlement'],
      message: 'an unavailable approval settlement must produce permission_unavailable',
    });
  }
});

const CommandExecutionStartedAuditEventSchema = z.object({
  kind: z.literal('execution_started'),
  occurred_at_ms: OccurredAtMsSchema,
  identity: CommandExecutionIdentitySchema,
  mode: CommandExecutionModeSchema,
  runtime: CommandExecutionAuditRuntimeSummarySchema,
  process_handle: CommandProcessHandleSchema.optional(),
}).strict();

export const CommandExecutionRejectionReasonSchema = z.enum([
  'request_cancelled',
  'launch_context_unavailable',
  'owner_rejected',
  'runtime_preparation_failed',
  'runtime_cleanup_failed',
  'runtime_invariant_failed',
  'approval_revoke_failed',
]);

export const CommandExecutionRejectedResourceStateSchema = z.enum([
  'not_acquired',
  'released',
  'release_unconfirmed',
]);

const CommandExecutionRejectedAuditEventSchema = z.object({
  kind: z.literal('execution_rejected'),
  occurred_at_ms: OccurredAtMsSchema,
  identity: CommandExecutionIdentitySchema,
  reason: CommandExecutionRejectionReasonSchema,
  resource_state: CommandExecutionRejectedResourceStateSchema,
}).strict();

const CommandProcessActionAuditEventSchema = z.object({
  kind: z.literal('process_action'),
  occurred_at_ms: OccurredAtMsSchema,
  identity: CommandExecutionIdentitySchema,
  control_tool_call_id: CommandControlToolCallIdSchema,
  action: CommandProcessActionSummarySchema,
  result: CommandProcessActionResultSchema,
}).strict();

const CommandProtectedInputAuditEventSchema = z.object({
  kind: z.literal('protected_input'),
  occurred_at_ms: OccurredAtMsSchema,
  identity: CommandExecutionIdentitySchema,
  process_handle: CommandProcessHandleSchema,
  attempt_id: z.string().regex(/^command_protected_input_[0-9a-f-]{36}$/),
  input_bytes: z.number().int().nonnegative()
    .max(MAX_PROCESS_INTERACTION_INPUT_BYTES),
  result: z.discriminatedUnion('status', [
    z.object({ status: z.literal('accepted') }).strict(),
    z.object({
      status: z.literal('rejected'),
      code: z.enum([
        'incompatible_state',
        'owner_ending',
        'owner_ended',
        'stdin_closed',
        'interaction_failed',
        'action_not_supported',
        'input_budget_exceeded',
      ]),
    }).strict(),
  ]),
}).strict();

const CommandExecutionTerminalAuditEventSchema = z.object({
  kind: z.literal('execution_terminal'),
  occurred_at_ms: OccurredAtMsSchema,
  terminal: CommandExecutionTerminalV1Schema,
}).strict();

/**
 * 审计只保存可长期解释的命令事实，不保存输出正文、环境变量、OS PID 或交互输入正文。
 * 这些内容既可能很大，也可能包含用户秘密；原始输出由专门的 artifact 边界负责。
 */
export const CommandExecutionAuditEventSchema = z.union([
  CommandProposalCreatedAuditEventSchema,
  CommandAuthorizationSettledAuditEventSchema,
  CommandExecutionRejectedAuditEventSchema,
  CommandExecutionStartedAuditEventSchema,
  CommandProcessActionAuditEventSchema,
  CommandProtectedInputAuditEventSchema,
  CommandExecutionTerminalAuditEventSchema,
]);
export type CommandExecutionAuditEvent = z.infer<
  typeof CommandExecutionAuditEventSchema
>;

export function parseCommandExecutionAuditEvent(
  value: unknown,
): CommandExecutionAuditEvent {
  return CommandExecutionAuditEventSchema.parse(value);
}
