import { z } from 'zod';

import { COMMAND_RUNTIME_PROTOCOL_VERSION } from './commandExecution';
import {
  CommandApprovalChoiceSchema,
  CommandApprovalReasonSchema,
} from './commandApproval';
import {
  CommandApprovalRequestIdSchema,
  CommandConversationIdSchema,
} from './commandIdentity';

export const COMMAND_APPROVAL_PAGE_OPEN_CHANNEL = 'command-approval:page-open';
export const COMMAND_APPROVAL_REPLY_CHANNEL = 'command-approval:reply';
export const COMMAND_APPROVAL_CHANGED_CHANNEL = 'command-approval:changed';

export const CommandApprovalPageTicketSchema = z.string()
  .min(1)
  .max(128)
  .brand<'CommandApprovalPageTicket'>();
export type CommandApprovalPageTicket = z.infer<typeof CommandApprovalPageTicketSchema>;

export const CommandApprovalPendingProjectionV1Schema = z.object({
  protocol_version: z.literal(COMMAND_RUNTIME_PROTOCOL_VERSION),
  kind: z.literal('command_approval_pending_projection'),
  approval_request_id: CommandApprovalRequestIdSchema,
  conversation_id: CommandConversationIdSchema,
  command: z.string(),
  cwd: z.string().min(1),
  reasons: z.array(CommandApprovalReasonSchema).min(1),
  available_choices: z.array(CommandApprovalChoiceSchema).min(2).max(3),
  conversation_token_prefix: z.array(z.string()).min(1).max(32).optional(),
  requested_at_ms: z.number().int().nonnegative().safe(),
  status: z.enum(['awaiting_reply', 'processing']),
}).strict().superRefine((projection, context) => {
  const supportsConversationApproval = projection.available_choices.includes(
    'allow_for_conversation',
  );
  if (supportsConversationApproval !== Boolean(projection.conversation_token_prefix)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['conversation_token_prefix'],
      message: 'conversation approval requires its visible token prefix',
    });
  }
});
export type CommandApprovalPendingProjectionV1 = z.infer<
  typeof CommandApprovalPendingProjectionV1Schema
>;

export const CommandApprovalPageSnapshotV1Schema = z.object({
  protocol_version: z.literal(COMMAND_RUNTIME_PROTOCOL_VERSION),
  kind: z.literal('command_approval_page_snapshot'),
  page_ticket: CommandApprovalPageTicketSchema,
  pending: z.array(CommandApprovalPendingProjectionV1Schema),
}).strict();
export type CommandApprovalPageSnapshotV1 = z.infer<
  typeof CommandApprovalPageSnapshotV1Schema
>;

export const CommandApprovalPageOpenResultV1Schema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    snapshot: CommandApprovalPageSnapshotV1Schema,
  }).strict(),
  z.object({
    success: z.literal(false),
    code: z.literal('owner_unavailable'),
  }).strict(),
]);
export type CommandApprovalPageOpenResultV1 = z.infer<
  typeof CommandApprovalPageOpenResultV1Schema
>;

export const CommandApprovalReplySubmissionV1Schema = z.object({
  protocol_version: z.literal(COMMAND_RUNTIME_PROTOCOL_VERSION),
  kind: z.literal('command_approval_reply_submission'),
  page_ticket: CommandApprovalPageTicketSchema,
  approval_request_id: CommandApprovalRequestIdSchema,
  choice: CommandApprovalChoiceSchema,
}).strict();
export type CommandApprovalReplySubmissionV1 = z.infer<
  typeof CommandApprovalReplySubmissionV1Schema
>;

export const CommandApprovalReplyResultV1Schema = z.object({
  success: z.literal(true),
  status: z.enum(['accepted', 'stale', 'invalid_page']),
}).strict();
export type CommandApprovalReplyResultV1 = z.infer<
  typeof CommandApprovalReplyResultV1Schema
>;

export const CommandApprovalChangedEventV1Schema = z.object({
  protocol_version: z.literal(COMMAND_RUNTIME_PROTOCOL_VERSION),
  kind: z.literal('command_approval_changed'),
  snapshot: CommandApprovalPageSnapshotV1Schema,
}).strict();
export type CommandApprovalChangedEventV1 = z.infer<
  typeof CommandApprovalChangedEventV1Schema
>;
