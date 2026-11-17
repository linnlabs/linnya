export type { OcrErrorKind } from '@linnya/plugin-host-contract/backend/documentParsingRuntime';

export class OcrTimeoutError extends Error {
  readonly provider?: string;
  readonly endpoint?: string;
  readonly timeoutMs: number;
  readonly cause?: unknown;

  constructor(message: string, options: { timeoutMs: number; provider?: string; endpoint?: string; cause?: unknown }) {
    super(message);
    this.name = 'OcrTimeoutError';
    this.timeoutMs = options.timeoutMs;
    this.provider = options.provider;
    this.endpoint = options.endpoint;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export class PdfLocalConversionError extends Error {
  readonly pageNum?: number;
  readonly tool?: string;
  readonly cause?: unknown;

  constructor(message: string, options: { pageNum?: number; tool?: string; cause?: unknown } = {}) {
    super(message);
    this.name = 'PdfLocalConversionError';
    this.pageNum = options.pageNum;
    this.tool = options.tool;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export class EmptyOcrContentError extends Error {
  readonly pageNum?: number;
  readonly cause?: unknown;

  constructor(message: string, options: { pageNum?: number; cause?: unknown } = {}) {
    super(message);
    this.name = 'EmptyOcrContentError';
    this.pageNum = options.pageNum;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}
