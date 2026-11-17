/**
 * KB 搜索结果项（Citation 使用的最小结构）
 */
export interface CitationKbSearchItem {
  /** 来源知识库 ID */
  kbId: string
  /** 来源知识库名称（UI 展示用） */
  kbName: string
  /** 文档 ID（作为 sourceId） */
  docId: string
  /** 文档标题 */
  docTitle: string
  /** 块 ID（可选，用于精确定位） */
  blockId?: string
  /** 页码（可选，PDF 等有页码的文档） */
  page?: number
  /** 搜索得分 */
  score: number
  /** 匹配的文本内容 */
  text: string
  /** 截断后的 snippet（展示用） */
  snippet: string
}

/** Editor 只消费引用候选，不持有插件目录、模型配置或业务 store。 */
export type KnowledgeCitationCandidate = Pick<CitationKbSearchItem,
  'docId' | 'docTitle' | 'blockId' | 'page' | 'score' | 'text'>;

export interface KnowledgeCitationSearchPort {
  /** 此查询由 Host 接入 Vue revision，可直接用于 computed/watch。 */
  isAvailable(): boolean;
  listProjectLibraries(projectId: string, signal: AbortSignal): Promise<Array<{ id: string; name: string }>>;
  searchLibrary(request: {
    projectId: string;
    kbId: string;
    query: string;
    topK: number;
  }, signal: AbortSignal): Promise<KnowledgeCitationCandidate[]>;
}
