import type {
  CanonicalLlmUsage,
  ContextCompactionErrorCode,
} from '../../../../../contracts';

export type ContextCompactionFailureReason =
  | 'CONTEXT_COMPACTION_UNAVAILABLE'
  | 'CONTEXT_COMPACTION_GENERATION_FAILED'
  | 'CONTEXT_COMPACTION_TOOL_CALL_REJECTED'
  | 'CONTEXT_COMPACTION_INVALID_OUTPUT'
  | 'CONTEXT_COMPACTION_REBUILD_FAILED'
  | 'CONTEXT_COMPACTION_INEFFECTIVE'
  | 'CONTEXT_COMPACTION_REBUILD_OVER_BUDGET'
  | 'CONTEXT_COMPACTION_TARGET_NOT_REACHED'
  | 'CONTEXT_COMPACTION_COMMIT_FAILED'
  | 'CONTEXT_COMPACTION_NO_REPLACEABLE_RANGE'
  | 'CONTEXT_COMPACTION_LIMIT_REACHED'
  | 'CONTEXT_COMPACTION_DUPLICATE_PLAN';

export interface ContextCompactionFailureMetrics {
  readonly durationMs: number;
  readonly compactionInputTokens: number;
  readonly canonicalUsage?: CanonicalLlmUsage;
  readonly afterTokens?: number;
  readonly summaryOutputTokens?: number;
  /** 原始摘要 / 被替换区段 token 比率；无效结果可大于等于 1。 */
  readonly compressionRatio?: number;
  readonly targetUnreachable?: boolean;
}

export interface ContextCompactionErrorOptions {
  readonly cause?: unknown;
  readonly metrics?: ContextCompactionFailureMetrics;
}

export class ContextCompactionError extends Error {
  readonly code: ContextCompactionErrorCode;
  readonly errorCode: ContextCompactionErrorCode;
  readonly recoverable = false;
  readonly reason: ContextCompactionFailureReason;
  readonly cause?: unknown;
  readonly metrics?: ContextCompactionFailureMetrics;

  constructor(
    code: ContextCompactionErrorCode,
    reason: ContextCompactionFailureReason,
    message: string,
    options?: ContextCompactionErrorOptions,
  ) {
    super(message);
    this.name = 'ContextCompactionError';
    this.code = code;
    this.errorCode = code;
    this.reason = reason;
    this.cause = options?.cause;
    this.metrics = options?.metrics;
  }
}
