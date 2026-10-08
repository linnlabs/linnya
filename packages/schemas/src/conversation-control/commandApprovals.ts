import { z } from 'zod';
import {
  CommandApprovalChoiceSchema,
  CommandApprovalPendingProjectionV1Schema,
  CommandApprovalRequestIdSchema,
} from '../commands';
import { CONVERSATION_CONTROL_SCHEMA_VERSION } from './protocol';

const ScopeFields = {
  schema_version: z.literal(CONVERSATION_CONTROL_SCHEMA_VERSION),
  command: z.literal('command_approvals'),
  conversation_id: z.string().trim().min(1),
  run_id: z.string().trim().min(1),
} as const;

/** list 可查询 root 子树；reply 必须指定请求实际所属 run，不用当前选中的会话猜测。 */
export const ConversationControlCommandApprovalsRequestSchema = z.discriminatedUnion('action', [
  z.object({ ...ScopeFields, action: z.literal('list') }).strict(),
  z.object({
    ...ScopeFields,
    action: z.literal('reply'),
    approval_request_id: CommandApprovalRequestIdSchema,
    choice: CommandApprovalChoiceSchema,
  }).strict(),
]);

export const ConversationControlCommandApprovalsResponseSchema = z.discriminatedUnion('action', [
  z.object({
    ...ScopeFields,
    ok: z.literal(true),
    action: z.literal('list'),
    pending: z.array(CommandApprovalPendingProjectionV1Schema),
  }).strict(),
  z.object({
    ...ScopeFields,
    ok: z.literal(true),
    action: z.literal('reply'),
    approval_request_id: CommandApprovalRequestIdSchema,
    // accepted 只确认回复接纳；授权持久化、进程启动与最终结果仍由原命令结算。
    status: z.enum(['accepted', 'stale']),
  }).strict(),
]);

export type ConversationControlCommandApprovalsRequest = z.infer<
  typeof ConversationControlCommandApprovalsRequestSchema
>;
export type ConversationControlCommandApprovalsResponse = z.infer<
  typeof ConversationControlCommandApprovalsResponseSchema
>;
