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
