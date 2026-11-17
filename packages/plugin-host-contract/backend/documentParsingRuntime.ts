import type { PluginInferencePort } from './inferenceRuntime';

/** 通用解析输出的唯一类型 owner；不含知识库状态、模型目录或凭据。 */
export type BlockId = string;

/**
 * 解析器的进度更新器函数类型
 */
export type ProgressUpdater = (progress: number, message: string) => void;

/**
 * 解析器输出的标准数据块结构
 */
export interface ParsedBlock {
  /** 块的唯一ID，由解析器生成 */
  blockId: BlockId;

  /** 块的文本内容 */
  text: string;

  /** 块的类型（如段落、标题、列表项、表格行） */
  type: 'paragraph' | 'heading1' | 'heading2' | 'heading3' | 'list_item' | 'table_row' | 'image';

  /** 块的元数据 */
  metadata?: Record<string, unknown>;

  /** 块的来源信息（例如页码、坐标等） */
  source_info?: SourceInfo;
}

export interface SourceInfo {
  page_number?: number;
  table_id?: string;
  row_idx?: number;
}

export type OcrErrorKind =
  | 'timeout'
  | 'rate_limited'
  | 'auth'
  | 'bad_request'
  | 'payload_too_large'
  | 'server'
  | 'network'
  | 'empty_content'
  | 'local_conversion'
  | 'unknown';

export type PdfParsePipeline =
  | 'text_extraction'
  | 'geometric_analysis'
  | 'vision_document_upload'
  | 'vision_page_image';

export interface PdfPageDiagnostic {
  pageNumber: number;
  errorKind: OcrErrorKind;
  message: string;
  retryable: boolean;
  shouldReduceConcurrency: boolean;
  shouldSplitSmaller: boolean;
}

export interface PdfParseDiagnostics {
  parser: 'pdf';
  pipeline: PdfParsePipeline;
  totalPages: number;
  parsedPages: number[];
  failedPages: PdfPageDiagnostic[];
  isPartial: boolean;
  createdAt: number;
}

export interface PdfParseOutcome {
  blocks: ParsedBlock[];
  diagnostics: PdfParseDiagnostics;
}

export type VisionStrategyDiagnosticResult =
  | {
      success: true;
      blocks: ParsedBlock[];
      diagnostics: PdfParseDiagnostics;
    }
  | {
      success: false;
      error: string;
      diagnostics?: PdfParseDiagnostics;
    };

export type DocumentParsingInference = Pick<PluginInferencePort, 'textGeneration' | 'documentOcr'>;

export interface PluginDocumentParseRequest {
  readonly bytes: Uint8Array;
  readonly documentId: string;
  readonly filename: string;
  readonly pdfOcrModelId?: string;
  readonly imageVisionModelId?: string;
  readonly forceVisionMode?: boolean;
  /** 调用方已准入且归属本次任务的素材目录，不能推断用户数据根。 */
  readonly temporaryDirectory: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: ProgressUpdater;
}
export interface PluginDocumentParseResult {
  readonly blocks: ParsedBlock[];
  readonly parser: string;
  readonly diagnostics?: PdfParseDiagnostics;
}
export interface PluginPdfPagesParseRequest {
  readonly path: string;
  readonly documentId: string;
  readonly pages: readonly number[];
  readonly totalPages: number;
  readonly modelId: string;
  readonly temporaryDirectory: string;
  readonly signal?: AbortSignal;
}

export declare function parsePluginDocument(request: PluginDocumentParseRequest, inference: DocumentParsingInference): Promise<PluginDocumentParseResult>;
export declare function countPluginPdfPages(bytes: Uint8Array): Promise<number>;
export declare function parsePluginPdfPages(request: PluginPdfPagesParseRequest, inference: DocumentParsingInference): Promise<VisionStrategyDiagnosticResult>;

/** 与解析输出共用确定性块身份，索引/SoT 后处理不能复制 UUID 规则。 */
export declare function generateParsedBlockId(documentId: string, index: number, text: string): BlockId;
