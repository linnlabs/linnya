/** 当前受管任务真正使用的固定操作名，不开放供应商、地址或凭据选择。 */
export type PluginInferenceOperation = 'embed' | 'text' | 'ocr-profile' | 'ocr';

/** 当前官方插件所需的模型操作。模型目录、路由、凭据与实际推理由 Host 持有。 */
export interface EmbeddingRequest {
  readonly modelId: string;
  readonly values: readonly string[];
  readonly signal?: AbortSignal;
  readonly maxParallelCalls?: number;
  /** 已存在向量索引的来源；不匹配时 Host 必须在发送请求前拒绝。 */
  readonly expectedSpaceId?: string;
}

export interface EmbeddingUsage {
  readonly inputTokens?: number;
  readonly raw: readonly unknown[];
}

export interface EmbeddingResult {
  /** 本次请求实际使用的向量空间配置身份；名称与凭据变更不影响该身份。 */
  readonly spaceId: string;
  readonly vectors: readonly (readonly number[])[];
  readonly usage?: EmbeddingUsage;
}

export type EmbeddingFailureKind = 'aborted' | 'transport' | 'provider' | 'protocol';


export interface EmbeddingPort {
  embed(request: EmbeddingRequest): Promise<EmbeddingResult>;
}

export interface RerankingRequest {
  readonly modelId: string;
  readonly query: string;
  readonly documents: readonly string[];
  readonly topN?: number;
  readonly signal?: AbortSignal;
}

export interface RerankingItem {
  readonly originalIndex: number;
  readonly score: number;
}

export interface RerankingUsage {
  readonly inputTokens?: number;
  readonly raw: unknown;
}

export interface RerankingResult {
  readonly ranking: readonly RerankingItem[];
  readonly usage?: RerankingUsage;
}

export type RerankingFailureKind = 'aborted' | 'transport' | 'provider' | 'protocol';


export interface RerankingPort {
  rerank(request: RerankingRequest): Promise<RerankingResult>;
}

import type { CanonicalLlmUsage } from '@linnlabs/linnkit/contracts';

export type TextGenerationImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp';

export type TextGenerationContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'image';
      readonly mediaType: TextGenerationImageMediaType;
      readonly bytes: Uint8Array;
    };

export type TextGenerationMessage =
  | { readonly role: 'system'; readonly content: string }
  | { readonly role: 'user'; readonly content: readonly TextGenerationContentBlock[] };

export interface TextGenerationRequest {
  readonly modelId: string;
  readonly messages: readonly TextGenerationMessage[];
  readonly temperature?: number;
  readonly topP?: number;
  readonly maxOutputTokens?: number;
  readonly reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  readonly signal?: AbortSignal;
}

export type TextGenerationFinishReason = 'stop' | 'length' | 'content_filter';

export interface TextGenerationResult {
  readonly text: string;
  readonly reasoning: string;
  readonly finishReason: TextGenerationFinishReason;
  readonly usage?: CanonicalLlmUsage;
}

export type TextGenerationFailureKind = 'aborted' | 'transport' | 'provider' | 'protocol';


export interface TextGenerationPort {
  generate(request: TextGenerationRequest): Promise<TextGenerationResult>;
}

export type OcrDocumentInput =
  | {
      kind: 'pdf_path';
      path: string;
    }
  | {
      kind: 'image_base64';
      base64: string;
      mimeType: 'image/jpeg' | 'image/png';
      pageNumber: number;
    };

export interface OcrDocumentPage {
  pageNumber: number;
  markdown: string;
  images?: Record<string, string>;
  outputImages?: Record<string, string>;
}

export interface OcrDocumentResult {
  pages: OcrDocumentPage[];
  totalPages?: number;
}

export interface OcrDocumentProgress {
  state: 'submitted' | 'pending' | 'running' | 'done';
  totalPages?: number;
  processedPages?: number;
  message?: string;
}

export interface OcrDocumentOptions {
  signal?: AbortSignal;
  optionalPayload?: Record<string, unknown>;
  onProgress?: (progress: OcrDocumentProgress) => void;
}

export interface DocumentOcrRequest {
  readonly modelId: string;
  readonly input: OcrDocumentInput;
  readonly options?: OcrDocumentOptions;
}

/**
 * Parser 只需要知道如何组织 OCR 业务流程，不应接触 Model Catalog 或 Provider 配置。
 */
export interface DocumentOcrModelProfile {
  readonly modelId: string;
  readonly displayName: string;
  readonly mode: 'document_upload' | 'page_image';
  readonly supportsAbortSignal: boolean;
  readonly attemptTimeoutMs: number;
  readonly maxInputPages?: number;
}

export interface DocumentOcrPort {
  resolveModelProfile(modelId: string): Promise<DocumentOcrModelProfile | undefined>;
  recognizeDocument(request: DocumentOcrRequest): Promise<OcrDocumentResult>;
}

export interface PluginInferencePort {
  readonly embedding: EmbeddingPort;
  readonly reranking: RerankingPort;
  readonly textGeneration: TextGenerationPort;
  readonly documentOcr: DocumentOcrPort;
}

export declare function getPluginInferencePort(): PluginInferencePort;
