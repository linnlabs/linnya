import { z } from 'zod';
import {
  COMMAND_APPROVAL_DENY_REASON_MAX_LENGTH,
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

/**
 * 外部调用方能不能代用户批准命令。默认不能：批准只能由人在桌面端或运行时自己的终端里给出。
 * 不能时带一段写给外部 Agent 的说明——为什么、该请用户做什么——它据此转告用户，而不是反复重试。
 */
export const ConversationControlExternalApprovalSchema = z.discriminatedUnion('permitted', [
  z.object({ permitted: z.literal(true) }).strict(),
  z.object({ permitted: z.literal(false), message: z.string().trim().min(1) }).strict(),
]);
export type ConversationControlExternalApproval = z.infer<
  typeof ConversationControlExternalApprovalSchema
>;

/** list 可查询 root 子树；reply 必须指定请求实际所属 run，不用当前选中的会话猜测。 */
export const ConversationControlCommandApprovalsRequestSchema = z.discriminatedUnion('action', [
  z.object({ ...ScopeFields, action: z.literal('list') }).strict(),
  z.object({
    ...ScopeFields,
    action: z.literal('reply'),
    approval_request_id: CommandApprovalRequestIdSchema,
    choice: CommandApprovalChoiceSchema,
    /** 只随 deny 提交：写进被拒命令的结果，让发起命令的 Agent 知道为什么、换个做法。 */
    deny_reason: z.string().trim().min(1).max(COMMAND_APPROVAL_DENY_REASON_MAX_LENGTH).optional(),
  }).strict(),
]).superRefine((request, context) => {
  if (request.action === 'reply' && request.deny_reason !== undefined && request.choice !== 'deny') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['deny_reason'],
      message: 'deny_reason is only accepted together with choice deny',
    });
  }
});

export const ConversationControlCommandApprovalsResponseSchema = z.discriminatedUnion('action', [
  z.object({
    ...ScopeFields,
    ok: z.literal(true),
    action: z.literal('list'),
    pending: z.array(CommandApprovalPendingProjectionV1Schema),
    external_approval: ConversationControlExternalApprovalSchema,
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
