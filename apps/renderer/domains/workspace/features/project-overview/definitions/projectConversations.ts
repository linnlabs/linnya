/** 项目概览的两页：文件、对话。 */
export type ProjectOverviewPage = 'files' | 'conversations';

export type ProjectConversationActivityRange = 'any' | 'today' | 'week' | 'month';
export type ProjectConversationDocumentsFilter = 'any' | 'changed' | 'unchanged';

export interface ProjectConversationFilters {
  readonly query: string;
  /** Agent 注册表 ID；null 为全部 Agent，空字符串为默认 Agent。 */
  readonly agent: string | null;
  readonly activity: ProjectConversationActivityRange;
  readonly documents: ProjectConversationDocumentsFilter;
}

export const EMPTY_PROJECT_CONVERSATION_FILTERS: ProjectConversationFilters = Object.freeze({
  query: '',
  agent: null,
  activity: 'any',
  documents: 'any',
});

export const PROJECT_CONVERSATION_COLUMN_IDS = ['title', 'agent', 'turns', 'documents', 'activity', 'storage'] as const;
export type ProjectConversationColumnId = (typeof PROJECT_CONVERSATION_COLUMN_IDS)[number];

export interface ProjectConversationSort {
  readonly key: ProjectConversationColumnId;
  readonly direction: 'asc' | 'desc';
}

/**
 * 对话的写操作属于对话领域（历史列表、删除生命周期、标题），由页面装配层接好传进来；
 * 项目概览只负责展示和发起。返回 false 表示用户取消或失败（失败提示由实现给出）。
 */
export interface ProjectConversationActions {
  readonly open: (conversationId: string) => void;
  readonly setPinned: (conversationId: string, pinned: boolean) => Promise<boolean>;
  readonly rename: (conversationId: string, title: string) => Promise<boolean>;
  readonly remove: (conversationId: string, title: string) => Promise<boolean>;
}
