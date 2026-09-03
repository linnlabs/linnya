import type {
  CommandApprovalRequestId,
  CommandConversationId,
} from '@app/schemas/commands';

import type {
  ConversationCommandApproval,
  ConversationCommandApprovalSaveResult,
} from '../definitions/commandApproval';

/** 删除 workflow 只获得不可逆清理所需的最小能力，不能顺带读取或创建批准。 */
export interface ConversationCommandApprovalDeletionPort {
  deleteForConversation(conversationId: CommandConversationId): Promise<void>;
}

export interface ConversationCommandApprovalPort {
  remember(
    approval: ConversationCommandApproval,
  ): Promise<ConversationCommandApprovalSaveResult>;
  listForConversation(
    conversationId: CommandConversationId,
  ): Promise<readonly ConversationCommandApproval[]>;
  revoke(approvalRequestId: CommandApprovalRequestId): Promise<void>;
}
