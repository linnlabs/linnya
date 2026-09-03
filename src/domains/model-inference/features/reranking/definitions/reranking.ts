export interface RerankingRequest {
  readonly modelId: string;
  readonly query: string;
  readonly documents: readonly string[];
  readonly topN?: number;
  readonly signal?: AbortSignal;
}

export interface RerankingItem {
  readonly originalIndex: number;
  readonly score: number;
}

export interface RerankingUsage {
  readonly inputTokens?: number;
  readonly raw: unknown;
}

export interface RerankingResult {
  readonly ranking: readonly RerankingItem[];
  readonly usage?: RerankingUsage;
}

export type RerankingFailureKind = 'aborted' | 'transport' | 'provider' | 'protocol';

export class RerankingFailure extends Error {
  constructor(
    readonly kind: RerankingFailureKind,
    readonly code: string,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'RerankingFailure';
  }
}

export interface RerankingPort {
  rerank(request: RerankingRequest): Promise<RerankingResult>;
}
