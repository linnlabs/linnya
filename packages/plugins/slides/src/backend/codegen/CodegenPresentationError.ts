import type { PresentationWriteFailure } from '../features/presentationBuildFailure';

export class CodegenPresentationError extends Error {
  readonly errorCode: number;
  readonly failure?: PresentationWriteFailure;

  constructor(message: string, errorCode: number, failure?: PresentationWriteFailure) {
    super(message);
    this.name = 'CodegenPresentationError';
    this.errorCode = errorCode;
    if (failure) this.failure = failure;
  }
}
