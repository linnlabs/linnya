import type {
  AiMessage,
  TokenCountConfidence,
  TokenCountSource,
  TokenRoute,
  TokenUsageCalibrationTrace,
} from '../../../contracts';
import { Logger } from '../../../shared/logger';

export interface RemoteTokenCountTrace {
  enabled: boolean;
  attempted: boolean;
  applied: boolean;
  route?: TokenRoute;
  inputTokens?: number;
  localEstimateTokens?: number;
  deltaTokens?: number;
  source?: TokenCountSource;
  confidence?: TokenCountConfidence;
  failureBehavior?: 'use-local-estimate' | 'fail-fast';
  failureReason?: string;
  skipReason?: 'image_input_local_only';
}

export interface MessageProcessingState {
  readonly message: AiMessage;
  readonly originalIndex: number;
  action: 'keep_core' | 'keep_working_memory' | 'skip';
  tokens: number;
  tokenCalibration?: TokenUsageCalibrationTrace;
  overrideContent?: string;
  overrideMetadata?: AiMessage['metadata'];
  contentType?: 'full' | 'final_answer_only' | 'thinking_only';
  phase?: string;
  replacementSourceIds?: string[];
}

export interface ProviderContext<TConfig = unknown> {
  totalBudget: number;
  config: TConfig;
  debugMode: boolean;
  estimateTokens: (message: AiMessage) => number;
  estimateTokensWithTrace?: (message: AiMessage) => {
    tokens: number;
    tokenCalibration?: TokenUsageCalibrationTrace;
  };
  remoteTokenCount?: RemoteTokenCountTrace;
}

export interface ProviderResult {
  states: MessageProcessingState[];
  tokensUsed: number;
  strategiesApplied: string[];
  stats: {
    processedCount: number;
    skippedCount: number;
    addedCount: number;
  };
}

export const TOOL_HISTORY_OVERFLOW_ERROR_CODE = 'TOOL_HISTORY_OVERFLOW' as const;
export const TOOL_REPLAY_PROTOCOL_ERROR_CODE = 'TOOL_REPLAY_PROTOCOL_INVALID' as const;

export type ContextProviderErrorCode =
  | 'context_provider_failed'
  | typeof TOOL_HISTORY_OVERFLOW_ERROR_CODE
  | typeof TOOL_REPLAY_PROTOCOL_ERROR_CODE;

export interface ContextProviderErrorOptions {
  code: ContextProviderErrorCode;
  fatal?: boolean;
  providerName: string;
  message: string;
  cause?: unknown;
}

/**
 * Provider 内部向 pipeline 传递的结构化错误。
 *
 * 中文备注：
 * - pipeline 只能依赖 code/fatal 这类稳定字段做控制流判断；
 * - message 只用于日志和用户可见错误，不再承担协议语义。
 */
export class ContextProviderError extends Error {
  readonly code: ContextProviderErrorCode;
  readonly errorCode: ContextProviderErrorCode;
  readonly recoverable: boolean;
  readonly fatal: boolean;
  readonly providerName: string;
  readonly metadata: Readonly<{ providerName: string; fatal: boolean }>;
  readonly cause?: unknown;

  constructor(options: ContextProviderErrorOptions) {
    super(options.message);
    this.name = 'ContextProviderError';
    this.code = options.code;
    this.errorCode = options.code;
    this.fatal = options.fatal ?? false;
    this.recoverable = !this.fatal;
    this.providerName = options.providerName;
    this.metadata = {
      providerName: options.providerName,
      fatal: this.fatal,
    };
    this.cause = options.cause;
  }
}

export function isContextProviderError(error: unknown): error is ContextProviderError {
  return error instanceof ContextProviderError;
}

export interface IContextProvider<TConfig = unknown> {
  readonly name: string;
  readonly description: string;
  readonly priority: number;

  provide(
    states: MessageProcessingState[],
    availableBudget: number,
    context: ProviderContext<TConfig>,
  ): Promise<ProviderResult>;

  shouldSkip?(
    states: MessageProcessingState[],
    availableBudget: number,
    context: ProviderContext<TConfig>,
  ): boolean;
}

export abstract class BaseContextProvider<TConfig = unknown>
  implements IContextProvider<TConfig>
{
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly priority: number;
  private readonly logger = new Logger(this.constructor.name);

  abstract provide(
    states: MessageProcessingState[],
    availableBudget: number,
    context: ProviderContext<TConfig>,
  ): Promise<ProviderResult>;

  shouldSkip(
    _states: MessageProcessingState[],
    availableBudget: number,
    _context: ProviderContext<TConfig>,
  ): boolean {
    return availableBudget <= 0;
  }

  protected debug(
    message: string,
    data?: Record<string, unknown>,
    context?: ProviderContext<TConfig>,
  ): void {
    if (context?.debugMode) {
      this.logger.debug(`[${this.name}] ${message}`, data);
    }
  }

  protected createResult(
    states: MessageProcessingState[],
    tokensUsed = 0,
    strategiesApplied: string[] = [],
    stats = { processedCount: 0, skippedCount: 0, addedCount: 0 },
  ): ProviderResult {
    return {
      states,
      tokensUsed,
      strategiesApplied,
      stats,
    };
  }
}
