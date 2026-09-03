/** Knowledge 交给外部持久化边界的捕获类型。 */
export type KnowledgeEvidenceCaptureKind =
  | 'knowledge_search_result'
  | 'knowledge_document_preview'
  | 'knowledge_document_chunk';

/**
 * Knowledge owner-owned capture DTO。
 *
 * 它只表达 Agent 实际看到的 Knowledge 来源事实，不复用
 * Evidence persistence record 的字段命名或存储语义。
 */
export interface KnowledgeEvidenceCaptureItem {
  readonly ref: string;
  readonly title: string;
  readonly snippet: string;
  readonly contentText: string;
  readonly capturedAtMs: number;
  readonly captureKind: KnowledgeEvidenceCaptureKind;
  readonly documentId: string;
  readonly blockId: string;
  readonly documentName?: string;
}
