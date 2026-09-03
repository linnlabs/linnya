import { z } from 'zod';

import {
  COMMAND_RUNTIME_PROTOCOL_VERSION,
  CommandExecutionIdentitySchema,
  hasSameCommandExecutionIdentity,
} from './commandExecution';
import { CommandApprovalRequestIdSchema } from './commandIdentity';
import { CommandPermissionSnapshotV1Schema } from './commandPermission';
import {
  SHELL_COMMAND_MAX_LENGTH,
  countShellCommandCharacters,
  ShellCommandProposalV1Schema,
} from './shellCommandProposal';

export const COMMAND_APPROVAL_MAX_TOKEN_COUNT = 32;
export const COMMAND_APPROVAL_MAX_TOKEN_LENGTH = SHELL_COMMAND_MAX_LENGTH;

export const CommandApprovalChoiceSchema = z.enum([
  'allow_once',
  'allow_for_conversation',
  'deny',
]);
export type CommandApprovalChoice = z.infer<typeof CommandApprovalChoiceSchema>;

const CommandPermissionElevationReasonSchema = z.object({
  type: z.literal('permission_elevation'),
  from_level: z.literal('read_only'),
  to_level: z.literal('standard'),
}).strict();

export const CommandRiskCategorySchema = z.enum([
  'delete',
  'move_overwrite_rename',
  'external_upload',
  'download_and_execute',
  'system_or_disk_impact',
]);
export type CommandRiskCategory = z.infer<typeof CommandRiskCategorySchema>;

const CommandFixedRiskRuleReasonSchema = z.object({
  type: z.literal('fixed_risk_rule'),
  rule_id: z.string().min(1).max(128),
  category: CommandRiskCategorySchema,
}).strict();

export const CommandApprovalReasonSchema = z.discriminatedUnion('type', [
  CommandPermissionElevationReasonSchema,
  CommandFixedRiskRuleReasonSchema,
]);
export type CommandApprovalReason = z.infer<typeof CommandApprovalReasonSchema>;

export const CommandConversationMatcherContextSchema = z.object({
  platform: z.enum(['macos', 'windows']),
  shell_semantics_id: z.string().min(1).max(128),
  matcher_revision: z.string().min(1).max(128),
}).strict();
export type CommandConversationMatcherContext = z.infer<
  typeof CommandConversationMatcherContextSchema
>;

/**
 * 只有明确解析出的单个简单命令才会生成；复杂 Shell 文本不提供对话级放行。
 * 匹配上下文与可见前缀一同冻结，避免恢复后用另一套 Shell 语义重新解释旧批准。
 */
export const CommandConversationApprovalCandidateSchema = z.object({
  token_prefix: z.array(
    z.string().refine(
      value => countShellCommandCharacters(value) <= COMMAND_APPROVAL_MAX_TOKEN_LENGTH,
      'a command token must fit within the command text budget',
    ),
  ).min(1).max(COMMAND_APPROVAL_MAX_TOKEN_COUNT),
  matching_context: CommandConversationMatcherContextSchema,
}).strict().superRefine((candidate, context) => {
  if (candidate.token_prefix[0].length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['token_prefix', 0],
      message: 'a simple command prefix requires a non-empty executable token',
    });
  }
  if (candidate.token_prefix.some(token => token.includes('\0'))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['token_prefix'],
      message: 'a simple command prefix must not contain NUL',
    });
  }
  if (
    candidate.token_prefix.reduce(
      (total, token) => total + countShellCommandCharacters(token),
      0,
    )
      > SHELL_COMMAND_MAX_LENGTH
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['token_prefix'],
      message: 'a simple command prefix must fit within the command text budget',
    });
  }
});
export type CommandConversationApprovalCandidate = z.infer<
  typeof CommandConversationApprovalCandidateSchema
>;

const CommandApprovalRequestBaseSchema = z.object({
  protocol_version: z.literal(COMMAND_RUNTIME_PROTOCOL_VERSION),
  kind: z.literal('command_approval_request'),
  approval_request_id: CommandApprovalRequestIdSchema,
  proposal: ShellCommandProposalV1Schema,
  reasons: z.array(CommandApprovalReasonSchema).min(1),
  requested_at_ms: z.number().int().nonnegative().safe(),
});

const OneTimeCommandApprovalRequestSchema = CommandApprovalRequestBaseSchema.extend({
  available_choices: z.tuple([
    z.literal('allow_once'),
    z.literal('deny'),
  ]),
  conversation_candidate: z.undefined().optional(),
}).strict();

const RememberableCommandApprovalRequestSchema = CommandApprovalRequestBaseSchema.extend({
  available_choices: z.tuple([
    z.literal('allow_once'),
    z.literal('allow_for_conversation'),
    z.literal('deny'),
  ]),
  conversation_candidate: CommandConversationApprovalCandidateSchema,
}).strict();

export const CommandApprovalRequestV1Schema = z.union([
  OneTimeCommandApprovalRequestSchema,
  RememberableCommandApprovalRequestSchema,
]).superRefine((request, context) => {
  const elevationReasons = request.reasons.filter(
    reason => reason.type === 'permission_elevation',
  );
  if (elevationReasons.length > 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reasons'],
      message: 'an approval request cannot repeat permission elevation',
    });
  }
  if (
    request.proposal.permission.base_level === 'read_only'
    && elevationReasons.length !== 1
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reasons'],
      message: 'a read-only approval request must explain its elevation to standard',
    });
  }

  const riskRuleIds = request.reasons.flatMap(reason => (
    reason.type === 'fixed_risk_rule' ? [reason.rule_id] : []
  ));
  if (new Set(riskRuleIds).size !== riskRuleIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reasons'],
      message: 'an approval request cannot repeat a risk rule',
    });
  }

  if (
    elevationReasons.length === 1
    && !(
      request.proposal.permission.base_level === 'read_only'
      && request.proposal.permission.effective_level === 'read_only'
      && request.proposal.permission.grant_source === 'global_setting'
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reasons'],
      message: 'permission elevation requires an unmodified read-only proposal',
    });
  }

  if (
    request.proposal.permission.grant_source !== 'global_setting'
    || request.proposal.permission.effective_level
      !== request.proposal.permission.base_level
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['proposal', 'permission'],
      message: 'an approval request requires an unmodified global permission snapshot',
    });
  }

  if (request.proposal.permission.base_level === 'full_access') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['proposal', 'permission', 'base_level'],
      message: 'full-access commands must not create approval requests',
    });
  }
});
export type CommandApprovalRequestV1 = z.infer<typeof CommandApprovalRequestV1Schema>;

/** renderer 只能选择 host 已提供的动作，不能把命令、cwd 或权限传回来。 */
export const CommandApprovalReplyV1Schema = z.object({
  protocol_version: z.literal(COMMAND_RUNTIME_PROTOCOL_VERSION),
  kind: z.literal('command_approval_reply'),
  approval_request_id: CommandApprovalRequestIdSchema,
  choice: CommandApprovalChoiceSchema,
}).strict();
export type CommandApprovalReplyV1 = z.infer<typeof CommandApprovalReplyV1Schema>;

const CommandApprovalSettlementBaseSchema = z.object({
  protocol_version: z.literal(COMMAND_RUNTIME_PROTOCOL_VERSION),
  kind: z.literal('command_approval_settlement'),
  approval_request_id: CommandApprovalRequestIdSchema,
  proposal_identity: CommandExecutionIdentitySchema,
  settled_at_ms: z.number().int().nonnegative().safe(),
});

const ApprovedCommandApprovalSettlementSchema = CommandApprovalSettlementBaseSchema.extend({
  outcome: z.literal('approved'),
  choice: z.enum(['allow_once', 'allow_for_conversation']),
  permission: CommandPermissionSnapshotV1Schema,
}).strict();

const RejectedCommandApprovalSettlementSchema = CommandApprovalSettlementBaseSchema.extend({
  outcome: z.literal('rejected'),
  reason: z.literal('user_rejected'),
}).strict();

const InvalidatedCommandApprovalSettlementSchema = CommandApprovalSettlementBaseSchema.extend({
  outcome: z.literal('invalidated'),
  reason: z.enum(['run_cancelled', 'owner_ended']),
}).strict();

const FailedCommandApprovalSettlementSchema = CommandApprovalSettlementBaseSchema.extend({
  outcome: z.literal('failed'),
  failure: z.enum([
    'authorization_unavailable',
    'conversation_approval_persistence_failed',
  ]),
}).strict();

export const CommandApprovalSettlementV1Schema = z.discriminatedUnion('outcome', [
  ApprovedCommandApprovalSettlementSchema,
  RejectedCommandApprovalSettlementSchema,
  InvalidatedCommandApprovalSettlementSchema,
  FailedCommandApprovalSettlementSchema,
]).superRefine((settlement, context) => {
  if (settlement.outcome !== 'approved') return;

  if (!hasSameCommandExecutionIdentity(
    settlement.proposal_identity,
    settlement.permission.identity,
  )) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['permission', 'identity'],
      message: 'approved permission must belong to the settled proposal',
    });
  }

  const expectedSource = settlement.choice === 'allow_once'
    ? 'allow_once'
    : 'conversation_approval';
  if (settlement.permission.grant_source !== expectedSource) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['permission', 'grant_source'],
      message: 'approved permission source must match the user choice',
    });
  }
});
export type CommandApprovalSettlementV1 = z.infer<
  typeof CommandApprovalSettlementV1Schema
>;

export function parseCommandApprovalRequest(value: unknown): CommandApprovalRequestV1 {
  return CommandApprovalRequestV1Schema.parse(value);
}

export function parseCommandApprovalReply(value: unknown): CommandApprovalReplyV1 {
  return CommandApprovalReplyV1Schema.parse(value);
}

export function parseCommandApprovalSettlement(
  value: unknown,
): CommandApprovalSettlementV1 {
  return CommandApprovalSettlementV1Schema.parse(value);
}
