import type { InternalFileReadProposalV1 } from '@app/schemas/commands';
import type { ConversationCommandApproval } from '../../../definitions/commandApproval';

export const INTERNAL_FILE_READ_MATCHER_REVISION = 'internal-storage-file-exact-v1';
export const INTERNAL_FILE_READ_SEMANTICS = 'native-file-read';

/** 文件路径已由物理 adapter 规范化；Shell 批准、别的对话和别的文件均不能匹配。 */
export function findInternalFileReadApproval(input: {
  readonly proposal: InternalFileReadProposalV1;
  readonly platform: 'macos' | 'windows';
  readonly approvals: readonly ConversationCommandApproval[];
}): ConversationCommandApproval | undefined {
  const { proposal } = input;
  return input.approvals.find(item => (
    item.conversationId === proposal.identity.conversation_id
    && item.approvedCwd === proposal.cwd
    && item.candidate.matching_context.platform === input.platform
    && item.candidate.matching_context.shell_semantics_id === INTERNAL_FILE_READ_SEMANTICS
    && item.candidate.matching_context.matcher_revision === INTERNAL_FILE_READ_MATCHER_REVISION
    && item.candidate.token_prefix.length === 1
    && item.candidate.token_prefix[0] === proposal.file_path
  ));
}
