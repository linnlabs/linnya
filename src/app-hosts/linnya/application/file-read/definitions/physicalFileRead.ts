import type { SupportedImageMediaType } from 'src/shared/media/image-inspection';

export const PHYSICAL_TEXT_FILE_MAX_BYTES = 20 * 1024 * 1024;
/** PDF 按页读取，不整本展开；上限取常见扫描报告与年鉴的体积。 */
export const PHYSICAL_PDF_FILE_MAX_BYTES = 100 * 1024 * 1024;

export type PhysicalFileReadErrorCode =
  | 'READ_FILE_LOCATOR_INVALID'
  | 'READ_FILE_NOT_FOUND'
  | 'READ_FILE_NOT_REGULAR_FILE'
  | 'READ_FILE_OS_ACCESS_DENIED'
  | 'READ_FILE_FILE_TOO_LARGE'
  | 'READ_FILE_TEXT_ENCODING_UNSUPPORTED'
  | 'READ_FILE_UNSUPPORTED_FORMAT'
  | 'READ_FILE_IMAGE_WINDOW_CONFLICT'
  | 'READ_FILE_IMAGE_INTEGRITY_FAILED'
  | 'READ_FILE_PDF_OPTION_UNSUPPORTED'
  | 'READ_FILE_PDF_WINDOW_CONFLICT'
  | 'READ_FILE_PDF_PAGE_OUT_OF_RANGE'
  | 'READ_FILE_PDF_UNREADABLE';

export class PhysicalFileReadError extends Error {
  readonly name = 'PhysicalFileReadError';

  constructor(
    readonly code: PhysicalFileReadErrorCode,
    message: string,
    readonly facts?: Readonly<Record<string, string | number>>,
  ) {
    // ToolRegistry 只把 Error.message 投影给 Agent；code 必须同时进入 message，
    // 否则结构化字段虽存在，跨运行时边界后会丢失稳定错误身份。
    super(`[${code}] ${message}`);
  }
}

export type PhysicalFileReadScope =
  | { readonly kind: 'host' }
  | {
      readonly kind: 'conversation';
      /** conversation lifecycle admission 回调提供的工作目录绝对路径。 */
      readonly rootPath: string;
    };

export type PhysicalTextContentType =
  | 'text/plain'
  | 'text/markdown'
  | 'application/json'
  | 'image/svg+xml';

export interface PhysicalTextFileReadResult {
  readonly kind: 'text';
  /** 解析 symlink 后实际打开的宿主路径，仅供 host use case 记录事实，不是用户提交 identity。 */
  readonly resolvedPath: string;
  readonly fileName: string;
  readonly contentType: PhysicalTextContentType;
  readonly byteLength: number;
  readonly text: string;
}

export interface PhysicalImageFileReadResult {
  readonly kind: 'image_source';
  /** managed-image ingress 应读取的 canonical source path。 */
  readonly resolvedPath: string;
  readonly fileName: string;
  readonly detectedMediaType: SupportedImageMediaType;
  readonly byteLength: number;
}

export interface PhysicalPdfFileReadResult {
  readonly kind: 'pdf_source';
  /** 已通过 containment 检查的 canonical 路径；PDF 由 file-read use case 按页打开。 */
  readonly resolvedPath: string;
  readonly fileName: string;
  readonly byteLength: number;
  readonly modifiedAtMs: number;
}

export type PhysicalFileReadResult =
  | PhysicalTextFileReadResult
  | PhysicalImageFileReadResult
  | PhysicalPdfFileReadResult;

export interface PhysicalFileReaderPort {
  readFile(input: {
    readonly absolutePath: string;
    readonly scope: PhysicalFileReadScope;
  }): Promise<PhysicalFileReadResult>;
}

export interface PhysicalFileImageSelection {
  readonly id: string;
  readonly uri: string;
}

interface PhysicalImageToolReadFacts {
  readonly kind: 'image';
  readonly locator: string;
  readonly resolvedPath: string;
  readonly fileName: string;
  readonly contentType: SupportedImageMediaType;
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
}

export type PhysicalFileToolReadResult =
  | (PhysicalPdfFileReadResult & { readonly locator: string })
  | (PhysicalTextFileReadResult & {
      /** 保留调用方的 canonical locator；不能被 symlink target identity 替换。 */
      readonly locator: string;
    })
  | (PhysicalImageToolReadFacts & {
      readonly attachmentStatus: 'attached';
      readonly selection: PhysicalFileImageSelection;
    })
  | (PhysicalImageToolReadFacts & {
      readonly attachmentStatus: 'already_attached' | 'not_delivered';
    });
