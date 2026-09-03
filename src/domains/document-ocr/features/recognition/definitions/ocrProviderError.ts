export interface OcrProviderErrorOptions {
  provider: string;
  endpoint?: string;
  statusCode?: number;
  statusText?: string;
  retryable?: boolean;
  cause?: unknown;
}

export class OcrProviderError extends Error {
  readonly provider: string;
  readonly endpoint?: string;
  readonly statusCode?: number;
  readonly statusText?: string;
  readonly retryable?: boolean;
  readonly cause?: unknown;

  constructor(message: string, options: OcrProviderErrorOptions) {
    super(message);
    this.name = 'OcrProviderError';
    this.provider = options.provider;
    this.endpoint = options.endpoint;
    this.statusCode = options.statusCode;
    this.statusText = options.statusText;
    this.retryable = options.retryable;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}
