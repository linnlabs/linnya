export interface EmbeddingRequest {
  readonly modelId: string;
  readonly values: readonly string[];
  readonly signal?: AbortSignal;
  readonly maxParallelCalls?: number;
  /** 已存在向量索引的来源；不匹配时 Host 必须在发送请求前拒绝。 */
  readonly expectedSpaceId?: string;
}

export interface EmbeddingUsage {
  readonly inputTokens?: number;
  readonly raw: readonly unknown[];
}

export interface EmbeddingResult {
  /** 本次请求实际使用的向量空间配置身份；名称与凭据变更不影响该身份。 */
  readonly spaceId: string;
  readonly vectors: readonly (readonly number[])[];
  readonly usage?: EmbeddingUsage;
}

export type EmbeddingFailureKind = 'aborted' | 'transport' | 'provider' | 'protocol';

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

export interface EmbeddingPort {
  embed(request: EmbeddingRequest): Promise<EmbeddingResult>;
}
