import {
  CommandApprovalRequestV1Schema,
  type InternalFileReadProposalV1,
} from '@app/schemas/commands';
import type { CommandApprovalPort, ConversationCommandApprovalPort } from '../../../ports';
import type { CommandProposalAuthorization } from '../definitions/commandProposalAuthorization';
import { resolveApprovedCommandPermission } from '../functions/resolveApprovedCommandPermission';
import { requestAndSettleCommandApproval } from './requestAndSettleCommandApproval';
import {
  findInternalFileReadApproval, INTERNAL_FILE_READ_MATCHER_REVISION, INTERNAL_FILE_READ_SEMANTICS,
} from '../functions/findInternalFileReadApproval';

/** 文件批准按 canonical 文件路径匹配，不能放行同目录其他文件或升级成 Shell 执行。 */
export async function authorizeInternalFileRead(input: {
  readonly proposal: InternalFileReadProposalV1;
  readonly platform: 'macos' | 'windows';
  readonly approvals: ConversationCommandApprovalPort;
  readonly approval: CommandApprovalPort;
  readonly createApprovalRequestUuid: () => string;
  readonly now: () => number;
  readonly abortSignal?: AbortSignal;
}): Promise<CommandProposalAuthorization> {
  const { proposal } = input;
  const context = { platform: input.platform, shellSemanticsId: INTERNAL_FILE_READ_SEMANTICS };
  if (input.abortSignal?.aborted) return { status: 'rejected', code: 'permission_unavailable' };
  if (proposal.permission.base_level === 'full_access') {
    return {
      status: 'authorized', context, permission: proposal.permission, presentationSource: 'global_setting',
    };
  }
  let approvals;
  try {
    approvals = await input.approvals.listForConversation(proposal.identity.conversation_id);
  } catch {
    return { status: 'rejected', code: 'permission_unavailable' };
  }
  const remembered = findInternalFileReadApproval({ proposal, platform: input.platform, approvals });
  if (remembered) {
    const permission = resolveApprovedCommandPermission({
      current: proposal.permission, source: 'conversation_approval',
      internalStorageAccess: true, elevateToStandard: false,
    });
    if (permission.status === 'rejected' || input.abortSignal?.aborted) {
      return { status: 'rejected', code: 'permission_unavailable' };
    }
    return {
      status: 'authorized', context, permission: permission.permission,
      presentationSource: 'conversation_approval_reused', approvalRequestId: remembered.approvalRequestId,
    };
  }
  const request = CommandApprovalRequestV1Schema.parse({
    protocol_version: 1, kind: 'command_approval_request',
    approval_request_id: `command_approval_${input.createApprovalRequestUuid()}`,
    proposal, reasons: [{ type: 'internal_storage_access' }],
    requested_at_ms: input.now(),
    available_choices: ['allow_once', 'allow_for_conversation', 'deny'],
    conversation_candidate: {
      token_prefix: [proposal.file_path],
      matching_context: {
        platform: input.platform, shell_semantics_id: context.shellSemanticsId, matcher_revision: INTERNAL_FILE_READ_MATCHER_REVISION,
      },
    },
  });
  return requestAndSettleCommandApproval({
    request, context, approvals: input.approvals, approval: input.approval, now: input.now,
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
  });
}
