import type { CommandApprovalChoice } from '@app/schemas/commands';

import type {
  CommandApprovalReplyAcceptance,
  CommandApprovalReplyContext,
} from '../../../definitions/commandApproval';
import { resolveApprovedCommandPermission } from './resolveApprovedCommandPermission';

function isChoiceAvailable(
  availableChoices: readonly CommandApprovalChoice[],
  choice: CommandApprovalChoice,
): boolean {
  return availableChoices.includes(choice);
}

/**
 * 回复只按 request identity 命中 host 保存的不可变提案。renderer 没有机会重新提交
 * command、cwd 或权限，因此 PC-25 的同源关系不会被 UI 状态改写。
 */
export function acceptCommandApprovalReply(
  context: CommandApprovalReplyContext,
): CommandApprovalReplyAcceptance {
  const { request, reply } = context;

  if (request.approval_request_id !== reply.approval_request_id) {
    return { status: 'rejected', code: 'request_mismatch' };
  }
  if (!isChoiceAvailable(request.available_choices, reply.choice)) {
    return { status: 'rejected', code: 'choice_not_available' };
  }
  if (reply.choice === 'deny') {
    return { status: 'accepted', decision: { type: 'reject' } };
  }

  const source = reply.choice === 'allow_once'
    ? 'allow_once'
    : 'conversation_approval';
  const permission = resolveApprovedCommandPermission({
    current: request.proposal.permission,
    source,
  });
  if (permission.status === 'rejected') {
    return { status: 'rejected', code: 'permission_not_approvable' };
  }

  if (reply.choice === 'allow_once') {
    return {
      status: 'accepted',
      decision: {
        type: 'approve_once',
        permission: permission.permission,
      },
    };
  }

  if (!request.conversation_candidate) {
    return { status: 'rejected', code: 'choice_not_available' };
  }
  if (request.proposal.kind !== 'shell_command_proposal') {
    return { status: 'rejected', code: 'choice_not_available' };
  }
  return {
    status: 'accepted',
    decision: {
      type: 'approve_for_conversation',
      permission: permission.permission,
      candidate: request.conversation_candidate,
      approvedCwd: request.proposal.cwd,
      requires_persistence: true,
    },
  };
}
