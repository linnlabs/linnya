import type { RuntimeEvent } from 'linnkit/contracts';

import type {
  ConversationWorkDirectoryConversationId,
} from '../../../../../domains/conversation-files';

export interface EnsureConversationFactsInput {
  readonly conversationId: ConversationWorkDirectoryConversationId;
  readonly initialEvents: readonly RuntimeEvent[];
  readonly projectId?: string;
  readonly mode?: string;
}

/**
 * 这个窄 port 只暴露 lifecycle admission 需要的两个事实动作，不能把 History DTO、
 * 分页读取或删除能力带入跨 domain use case。
 */
export interface ConversationFactsPort {
  exists(conversationId: ConversationWorkDirectoryConversationId): Promise<boolean>;
  ensure(input: EnsureConversationFactsInput): Promise<void>;
}
