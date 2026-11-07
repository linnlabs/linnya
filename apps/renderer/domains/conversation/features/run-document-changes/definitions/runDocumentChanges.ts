import type { Component } from 'vue';

/**
 * 每份文档只显示它自己 owner 的状态；Conversation 只负责展示，不解释文档类型。
 * - `pending`：有待审阅修订（内建 Markdown）。
 * - `applied`：改动已直接生效，通过文档历史恢复（目前是 Slides）。
 * - `none`：没有需要提示的状态，例如新建的文档。
 */
export type RunDocumentChangeStatus =
  | { readonly kind: 'pending'; readonly count: number }
  | { readonly kind: 'applied' }
  | { readonly kind: 'none' };

/** 行尾按钮：去 owner 自己的审阅或历史；没有就只能点整行打开。 */
export type RunDocumentChangeAction = 'review' | 'history';

export type RunDocumentChangeOpenIntent = 'open' | RunDocumentChangeAction;

export interface RunDocumentChangeItem {
  readonly documentId: string;
  readonly projectId: string;
  readonly parentId: string | null;
  readonly title: string;
  readonly iconComponent: Component;
  readonly iconClass: string;
  /** 已启用文档类型的打开身份；类型不可用时为 null，不能打开。 */
  readonly activeDocumentType: string | null;
  readonly deleted: boolean;
  readonly created: boolean;
  /** 只有子任务改过它。 */
  readonly bySubrunOnly: boolean;
  readonly status: RunDocumentChangeStatus;
  readonly action: RunDocumentChangeAction | null;
}

export interface RunDocumentChangeList {
  readonly items: readonly RunDocumentChangeItem[];
  readonly truncated: boolean;
}

export interface RunDocumentChangesRequest {
  readonly conversationId: string;
  readonly rootRunIds: readonly string[];
}

export interface RunDocumentChangesPort {
  list(request: RunDocumentChangesRequest): Promise<RunDocumentChangeList>;
  open(item: RunDocumentChangeItem, intent: RunDocumentChangeOpenIntent): Promise<void>;
  /** 这些文档改名、删除或修订被处理时回调，用于刷新状态；返回取消订阅。 */
  watch(documentIds: ReadonlySet<string>, onChange: () => void): () => void;
}
