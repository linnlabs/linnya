import type { CommandApprovalControlPort } from 'src/domains/commands';
import type { ConversationControlRunRecord } from '../../conversation-control';

export interface ConversationActivityPorts {
  readonly runs: {
    readCandidates(conversationIds: readonly string[]): Promise<ReadonlyMap<string, readonly ConversationControlRunRecord[]>>;
  };
  readonly approvals: Pick<CommandApprovalControlPort, 'readControlPending'>;
}
