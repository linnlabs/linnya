import type { ConversationMessageKey } from '../../../definitions/conversationMessages';
import type { RunDocumentChangeItem } from '../definitions/runDocumentChanges';
import { formatWorkspaceFileTarget } from '../../../ui/tools/workspace/functions/createWorkspaceFileActionTitle';

export interface RunDocumentChangeLabel {
  readonly key: ConversationMessageKey;
  readonly params?: Readonly<Record<string, number>>;
}

/** 与工具卡同一套写法：去掉最后一段后缀（“会议纪要.md”显示为“会议纪要”）。 */
export function resolveRunDocumentChangeDisplayTitle(item: RunDocumentChangeItem): string {
  return formatWorkspaceFileTarget(item.title);
}

/** 行右侧的状态词；已删除或类型不可用优先，其次是 owner 状态。 */
export function resolveRunDocumentChangeStateKey(item: RunDocumentChangeItem): RunDocumentChangeLabel | null {
  if (item.deleted) return { key: 'conversation.runChanges.deleted' };
  if (item.activeDocumentType === null) return { key: 'conversation.runChanges.unavailable' };
  switch (item.status.kind) {
    case 'pending':
      return { key: 'conversation.runChanges.pendingCount', params: { count: item.status.count } };
    case 'applied':
      return { key: 'conversation.runChanges.applied' };
    case 'none':
      return null;
  }
}

/** 名字旁的小字：谁做了什么。 */
export function resolveRunDocumentChangeMetaKey(item: RunDocumentChangeItem): ConversationMessageKey {
  if (item.bySubrunOnly) {
    return item.created ? 'conversation.runChanges.subrunCreated' : 'conversation.runChanges.subrunUpdated';
  }
  return item.created ? 'conversation.runChanges.created' : 'conversation.runChanges.updated';
}

export function resolveRunDocumentChangeActionKey(item: RunDocumentChangeItem): ConversationMessageKey | null {
  if (item.deleted || item.activeDocumentType === null || !item.action) return null;
  return item.action === 'review' ? 'conversation.runChanges.action.review' : 'conversation.runChanges.action.history';
}
