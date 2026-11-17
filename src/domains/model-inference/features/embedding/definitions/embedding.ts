import type { EmbeddingFailureKind } from '@linnya/plugin-host-contract/backend/inferenceRuntime';
export type { EmbeddingRequest, EmbeddingUsage, EmbeddingResult, EmbeddingFailureKind, EmbeddingPort } from '@linnya/plugin-host-contract/backend/inferenceRuntime';

export class EmbeddingFailure extends Error {
  constructor(
    readonly kind: EmbeddingFailureKind,
    readonly code: string,
    readonly retryable: boolean,
    message: string
  ) {
    super(message);
    this.name = 'EmbeddingFailure';
  }
}
