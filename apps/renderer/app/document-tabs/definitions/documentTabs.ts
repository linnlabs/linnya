/** 打开一个标签需要的身份信息，足够重新调用文档导航打开它。 */
export interface DocumentTabIdentity {
  readonly id: string;
  readonly type: string;
  readonly projectId: string;
  readonly displayName: string | null;
  readonly parentId: string | null;
}

export type DocumentTab = DocumentTabIdentity;

export interface DocumentTabsState {
  /** 标签栏从左到右的顺序。 */
  readonly tabs: readonly DocumentTab[];
  /** 最近使用顺序，第一项是当前标签。 */
  readonly recent: readonly string[];
  /** 关闭过的标签，最后一项最新。 */
  readonly closed: readonly DocumentTab[];
}

export interface DocumentTabsCloseResult {
  readonly state: DocumentTabsState;
  /** 关掉的标签里是否包含当前标签。 */
  readonly activeClosed: boolean;
  /** 当前标签被关闭后应切到的标签；没有剩余标签时为 null。 */
  readonly nextActive: DocumentTab | null;
}
