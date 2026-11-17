export interface KnowledgeSourceTarget {
  readonly sourceId: string;
  readonly containerId?: string;
  readonly projectId: string | null;
}

export interface KnowledgeMarkdownImport {
  readonly targetKbId: string;
  readonly documentName: string;
  readonly markdown: string;
  /** 取消尚未接纳的动作；接纳后的摄入由知识库任务 owner 管理。 */
  readonly signal: AbortSignal;
}
