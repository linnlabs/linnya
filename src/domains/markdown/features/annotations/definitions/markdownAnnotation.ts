import type { MarkdownDocJson } from '../../normalization/runtime';

export interface MarkdownAnnotation {
  readonly id: string;
  readonly document_node_id: string;
  readonly target_block_id: string;
  readonly content_json: string;
  readonly created_at: number;
  readonly updated_at: number;
  readonly resolved_at: number | null;
  readonly deleted_at: number | null;
}

export interface CreateMarkdownAnnotationInput {
  readonly id: string;
  readonly documentNodeId: string;
  readonly targetBlockId: string;
  readonly contentJson: string;
  readonly createdAt: string;
}

/** 批注 feature 只需要读取文档块身份，不依赖正文持久化实现。 */
export interface MarkdownAnnotationDocumentReader {
  getDocument(documentNodeId: string): MarkdownDocJson;
}
