import type { CommandApprovalControlPort } from 'src/domains/commands';
import type { ConversationControlRunRecord } from '../../conversation-control';

export interface ConversationActivityPorts {
  readonly runs: {
    readCandidates(conversationIds: readonly string[]): Promise<ReadonlyMap<string, readonly ConversationControlRunRecord[]>>;
  };
  readonly approvals: Pick<CommandApprovalControlPort, 'readControlPending'>;
}

/** 可能不空闲的对话：有活跃前台根，或最近一次终态前台根不是 completed。 */
export interface ConversationActivityCandidate {
  readonly conversationId: string;
  readonly projectId: string | null;
}

/** 全工作区列表额外需要候选查询；按对话读取的调用方不必提供。 */
export interface ConversationActivityListPorts extends ConversationActivityPorts {
  readonly runs: ConversationActivityPorts['runs'] & {
    /** 非空闲对话的超集；精确状态仍由 readCandidates + 投影决定。 */
    listActivityCandidates(): Promise<readonly ConversationActivityCandidate[]>;
  };
}
