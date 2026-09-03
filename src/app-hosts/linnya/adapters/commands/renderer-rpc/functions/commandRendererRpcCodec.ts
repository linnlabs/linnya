import { z } from 'zod';
import {
  CommandApprovalPageSnapshotV1Schema,
  CommandApprovalPageTicketSchema,
  CommandApprovalReplyResultV1Schema,
  CommandApprovalReplySubmissionV1Schema,
  CommandCardCancelResultV1Schema,
  CommandCardCancelSubmissionV1Schema,
  CommandCardControlPageSnapshotV1Schema,
  CommandCardControlPageTicketSchema,
  CommandPermissionSettingsReadResultV1Schema,
  CommandPermissionSettingsUpdateResultV1Schema,
  CommandPermissionSettingsUpdateV1Schema,
  CommandProtectedInputResultV1Schema,
  CommandProtectedInputSubmissionV1Schema,
} from '@app/schemas/commands';

const OwnerIdSchema = z.number().int().nonnegative();
const ConversationIdSchema = z.string().min(1);

export const CommandApprovalPageOpenRpcRequestSchema = z.object({
  owner_id: OwnerIdSchema,
}).strict();
export const CommandApprovalPageReadRpcRequestSchema = z.object({
  owner_id: OwnerIdSchema,
  page_ticket: CommandApprovalPageTicketSchema,
}).strict();
export const CommandApprovalPageInvalidateRpcRequestSchema =
  CommandApprovalPageReadRpcRequestSchema;
export const CommandApprovalReplyRpcRequestSchema = z.object({
  owner_id: OwnerIdSchema,
  submission: CommandApprovalReplySubmissionV1Schema,
}).strict();

export const CommandCardPageOpenRpcRequestSchema = z.object({
  owner_id: OwnerIdSchema,
  conversation_id: ConversationIdSchema,
}).strict();
export const CommandCardPageReadRpcRequestSchema = z.object({
  owner_id: OwnerIdSchema,
  page_ticket: CommandCardControlPageTicketSchema,
}).strict();
export const CommandCardPageInvalidateRpcRequestSchema =
  CommandCardPageReadRpcRequestSchema;
export const CommandCardCancelRpcRequestSchema = z.object({
  owner_id: OwnerIdSchema,
  submission: CommandCardCancelSubmissionV1Schema,
}).strict();
export const CommandProtectedInputRpcRequestSchema = z.object({
  owner_id: OwnerIdSchema,
  submission: CommandProtectedInputSubmissionV1Schema,
}).strict();

export const CommandPermissionSettingsUpdateRpcRequestSchema = z.object({
  update: CommandPermissionSettingsUpdateV1Schema,
}).strict();
export const CommandPermissionSettingsReadRpcResponseSchema =
  CommandPermissionSettingsReadResultV1Schema;
export const CommandPermissionSettingsUpdateRpcResponseSchema =
  CommandPermissionSettingsUpdateResultV1Schema;
export const CommandApprovalPageRpcResponseSchema =
  CommandApprovalPageSnapshotV1Schema.nullable();
export const CommandApprovalReplyRpcResponseSchema =
  CommandApprovalReplyResultV1Schema;
export const CommandCardPageRpcResponseSchema =
  CommandCardControlPageSnapshotV1Schema.nullable();
export const CommandCardCancelRpcResponseSchema = CommandCardCancelResultV1Schema;
export const CommandProtectedInputRpcResponseSchema =
  CommandProtectedInputResultV1Schema;
export const CommandVoidRpcResponseSchema = z.null();
export const CommandChangedRpcPayloadSchema = z.null();
