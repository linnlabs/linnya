import type { DocumentHistoryFailureCode } from '@app/schemas';

export class DocumentHistoryError extends Error {
  constructor(readonly code: DocumentHistoryFailureCode) {
    super(`Document history: ${code}`);
    this.name = 'DocumentHistoryError';
  }
}
