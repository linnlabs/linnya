import type { EmbeddingFailureKind, RerankingFailureKind } from './inferenceRuntime';

/** 同一进程内复用 Host 原错误身份；跨 Worker 的字段通过既有错误协议传递。 */
export declare class EmbeddingFailure extends Error {
  readonly kind: EmbeddingFailureKind;
  readonly code: string;
  readonly retryable: boolean;
  constructor(kind: EmbeddingFailureKind, code: string, retryable: boolean, message: string);
}
export declare class RerankingFailure extends Error {
  readonly kind: RerankingFailureKind;
  readonly code: string;
  readonly retryable: boolean;
  constructor(kind: RerankingFailureKind, code: string, retryable: boolean, message: string);
}
