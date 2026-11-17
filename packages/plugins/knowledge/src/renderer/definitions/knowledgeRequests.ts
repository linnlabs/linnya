import type { KnowledgeBaseCatalogItem } from './knowledgeBaseRuntime';

export type KnowledgeSettingsUpdate = Partial<Pick<KnowledgeBaseCatalogItem,
  'name' | 'description' | 'tags' | 'enableGraphIndexing' | 'embeddingModelId' |
  'rerankModelId' | 'pdfOcrModelId' | 'imageVisionModelId' | 'visionModelId'>>;

/** 上传表单只承载用途绑定 ID；凭据始终由 Host 持有。 */
export interface KnowledgeUploadModels {
  readonly embedding_model_id?: string | null;
  readonly rerank_model_id?: string | null;
  readonly pdf_ocr_model_id?: string | null;
  readonly image_vision_model_id?: string | null;
  readonly graph_extraction_model_id?: string | null;
  readonly vision_model_id?: string | null;
  readonly force_vision_mode?: boolean;
}
export interface KnowledgeSearchRequest {
  readonly query: string;
  readonly topK?: number;
  readonly useReranking?: boolean;
  readonly filter?: Readonly<Record<string, unknown>>;
  readonly embeddingModelId?: string | null;
  readonly rerankModelId?: string | null;
}
