import type { ConversationReference } from '../../../types';

export interface PrepareComposerReferencesOptions {
  readonly references: readonly ConversationReference[];
  readonly projectId: string | null;
  readonly conversationId: string | null;
  readonly signal: AbortSignal;
  /** 输入框切换、引用移除或组件关闭后，旧准备结果不得再发送。 */
  readonly isCurrent: () => boolean;
}
