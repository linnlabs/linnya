import type {
  CommandConversationApprovalCandidate,
  CommandConversationId,
} from '@app/schemas/commands';

import type { ConversationCommandApproval } from '../../../definitions/commandApproval';
import {
  type ConversationCommandApprovalMatch,
} from '../definitions/simpleCommand';
import { isSupportedSimpleCommandContext } from './isSupportedSimpleCommandContext';
import { validateRememberableSimpleCommandPrefix } from './validateRememberableSimpleCommandPrefix';

function hasSameContext(
  left: CommandConversationApprovalCandidate,
  right: CommandConversationApprovalCandidate,
): boolean {
  return left.matching_context.platform === right.matching_context.platform
    && left.matching_context.shell_semantics_id === right.matching_context.shell_semantics_id
    && left.matching_context.matcher_revision === right.matching_context.matcher_revision;
}

function isTokenPrefix(
  prefix: readonly string[],
  command: readonly string[],
): boolean {
  return prefix.length <= command.length
    && prefix.every((token, index) => token === command[index]);
}

function compareMatches(
  left: ConversationCommandApproval,
  right: ConversationCommandApproval,
): number {
  const specificity = right.candidate.token_prefix.length - left.candidate.token_prefix.length;
  if (specificity !== 0) return specificity;
  if (left.approvedAtMs !== right.approvedAtMs) {
    return left.approvedAtMs < right.approvedAtMs ? 1 : -1;
  }
  if (left.approvalRequestId === right.approvalRequestId) return 0;
  return left.approvalRequestId < right.approvalRequestId ? -1 : 1;
}

/**
 * 按 token 边界匹配，避免 `git` 错放 `git-malicious`。多个批准都能覆盖时选 token
 * 最长、权限范围最窄且最新的一条，并返回真实请求身份，审计不依赖数据库返回顺序。
 */
export function matchConversationCommandApproval(params: {
  readonly conversationId: CommandConversationId;
  readonly candidate: CommandConversationApprovalCandidate;
  readonly approvals: readonly ConversationCommandApproval[];
}): ConversationCommandApprovalMatch {
  if (!isSupportedSimpleCommandContext(params.candidate.matching_context)) {
    return { status: 'unavailable', reason: 'unsupported_matcher_context' };
  }
  if (
    validateRememberableSimpleCommandPrefix(params.candidate.token_prefix).status
      !== 'rememberable'
  ) {
    return { status: 'unavailable', reason: 'invalid_current_candidate' };
  }

  const approvalsInCurrentContext = params.approvals.filter(approval => (
    approval.conversationId === params.conversationId
    && hasSameContext(approval.candidate, params.candidate)
  ));
  if (approvalsInCurrentContext.some(
    approval => validateRememberableSimpleCommandPrefix(
      approval.candidate.token_prefix,
    ).status !== 'rememberable',
  )) {
    return { status: 'unavailable', reason: 'invalid_stored_approval' };
  }

  const matches = approvalsInCurrentContext.filter(approval => (
    isTokenPrefix(
      approval.candidate.token_prefix,
      params.candidate.token_prefix,
    )
  ));
  if (matches.length === 0) return { status: 'not_matched' };

  matches.sort(compareMatches);
  return { status: 'matched', approval: matches[0] };
}
