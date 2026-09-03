import type { RuntimeEvent } from 'linnkit/contracts';

import type {
  ConversationWorkDirectoryResolution,
} from '../../../../../domains/conversation-files';

export type ConversationPersistenceStatus = 'created' | 'existing';

/**
 * ready 表示没有已知历史文件损失；另外两种状态都必须保留下来，供未来 Agent 上下文
 * 和命令卡片明确说明“当前是新建的空目录”，不能让用户误以为旧文件仍然存在。
 */
export type ConversationWorkFilesStatus =
  | 'ready'
  | 'historical_files_unavailable'
  | 'previous_files_unavailable';

export interface ConversationPersistenceAdmissionInput {
  readonly conversationId: unknown;
  readonly initialEvents: readonly RuntimeEvent[];
  readonly projectId?: string;
  readonly mode?: string;
}

export interface ConversationPersistenceAdmission {
  readonly conversationStatus: ConversationPersistenceStatus;
  readonly workFilesStatus: ConversationWorkFilesStatus;
  readonly directory: ConversationWorkDirectoryResolution;
}

export interface ConversationPersistenceAdmissionPort {
  withAdmission<T>(
    input: ConversationPersistenceAdmissionInput,
    admitted: (admission: ConversationPersistenceAdmission) => Promise<T> | T,
  ): Promise<T>;
}
