export interface EmbeddingRequest {
  readonly modelId: string;
  readonly values: readonly string[];
  readonly signal?: AbortSignal;
  readonly maxParallelCalls?: number;
}

export interface EmbeddingUsage {
  readonly inputTokens?: number;
  readonly raw: readonly unknown[];
}

export interface EmbeddingResult {
  readonly vectors: readonly (readonly number[])[];
  readonly usage?: EmbeddingUsage;
}

export type EmbeddingFailureKind = 'aborted' | 'transport' | 'provider' | 'protocol';

export class EmbeddingFailure extends Error {
  constructor(
    readonly kind: EmbeddingFailureKind,
    readonly code: string,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'EmbeddingFailure';
  }
}

export interface EmbeddingPort {
  embed(request: EmbeddingRequest): Promise<EmbeddingResult>;
}
