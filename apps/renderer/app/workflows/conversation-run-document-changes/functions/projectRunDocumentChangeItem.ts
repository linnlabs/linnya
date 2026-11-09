import type { Component } from 'vue';
import type { ConversationRunDocumentChange } from '@app/schemas';
import type { RunDocumentChangeItem } from '@/domains/conversation/features/run-document-changes';

export interface RunDocumentChangeTypeFacts {
  /** 已启用文档类型的打开身份；未启用或缺失为 null。 */
  readonly activeDocumentType: string | null;
  readonly iconComponent: Component;
  readonly iconClass: string;
  /** 该类型提供文档历史（目前是 Slides）：改动直接生效，靠历史恢复。 */
  readonly hasDocumentHistory: boolean;
}

/**
 * 每份文档只用自己类型的审阅方式：有待审阅修订进审阅；直接生效且有文档历史的进历史；
 * 新建的文档没有可恢复的旧版本，只提供打开。其他类型（例如画布）不在这里推测状态。
 */
export function projectRunDocumentChangeItem(
  change: ConversationRunDocumentChange,
  type: RunDocumentChangeTypeFacts,
): RunDocumentChangeItem {
  const deleted = change.presence === 'deleted';
  const pendingCount = change.pending_revision_count ?? 0;
  const pending = !deleted && pendingCount > 0;
  const applied = !deleted && !pending && !change.created && type.hasDocumentHistory;
  return {
    documentId: change.document_id,
    projectId: change.project_id,
    parentId: change.parent_id,
    title: change.title,
    iconComponent: type.iconComponent,
    iconClass: type.iconClass,
    activeDocumentType: type.activeDocumentType,
    deleted,
    created: change.created,
    bySubrunOnly: change.actor === 'subrun',
    status: pending
      ? { kind: 'pending', count: pendingCount }
      : applied ? { kind: 'applied' } : { kind: 'none' },
    action: pending ? 'review' : applied ? 'history' : null,
  };
}
