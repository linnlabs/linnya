import { z } from 'zod';

import {
  CommandApprovalChoiceSchema,
  CommandApprovalPendingProjectionV1Schema,
  CommandApprovalRequestIdSchema,
} from '@app/schemas/commands';

export const CommandApprovalHostPresenterSnapshotSchema = z.object({
  protocol_version: z.literal(1),
  kind: z.literal('command_approval_host_presenter_snapshot'),
  pending: z.array(CommandApprovalPendingProjectionV1Schema),
}).strict();

export const CommandApprovalHostPresenterReadResponseSchema =
  CommandApprovalHostPresenterSnapshotSchema.nullable();

export const CommandApprovalHostPresenterReplyRequestSchema = z.object({
  approval_request_id: CommandApprovalRequestIdSchema,
  choice: CommandApprovalChoiceSchema,
}).strict();

export const CommandApprovalHostPresenterReplyResponseSchema = z.object({
  status: z.enum(['accepted', 'stale', 'unavailable']),
}).strict();

export const CommandApprovalHostPresenterChangedPayloadSchema = z.null();
export const CommandApprovalHostPresenterVoidResponseSchema = z.null();
