import type { DocumentHistoryFailureCode } from '@app/schemas';

export class DocumentHistoryError extends Error {
  readonly cause?: unknown;
  constructor(readonly code: DocumentHistoryFailureCode, options?: { readonly cause: unknown }) {
    super(`Document history: ${code}`);
    this.name = 'DocumentHistoryError';
    this.cause = options?.cause;
  }
}
