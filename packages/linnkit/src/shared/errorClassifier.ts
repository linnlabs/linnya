/**
 * @file src/agent/shared/errorClassifier.ts
 *
 * @brief Agent runtime 自己拥有的错误分类器
 *
 * @description
 * 错误分类与重试策略属于 Agent runtime 的执行协议，不应该继续由 app shared owner 持有。
 */

import { Logger } from './logger';

export enum ErrorCategory {
  RETRYABLE = 'retryable',
  NON_RETRYABLE = 'non_retryable',
  RATE_LIMIT = 'rate_limit',
}

export const ENGINE_ERROR_CODES = {
  LLM_RATE_LIMIT: 'llm.rate_limit',
  LLM_INVALID_TOOL_ARGS: 'llm.invalid_tool_args',
  LLM_PROVIDER_DOWN: 'llm.provider_down',
  LLM_UNSUPPORTED_CAPABILITY: 'llm.unsupported_capability',
  LLM_AUTH_FAILED: 'llm.auth_failed',
  LLM_INVALID_REQUEST: 'llm.invalid_request',
  LLM_RESOURCE_NOT_FOUND: 'llm.resource_not_found',
  LLM_OUTPUT_LIMIT_REACHED: 'llm.output_limit_reached',
  LLM_CONTENT_FILTERED: 'llm.content_filtered',
  // 已声明但 emit 端未接通(见 15 号 Q-M15):工具运行时尚未实现超时机制,目前不会被 wire 上观察到
  TOOL_TIMEOUT: 'tool.timeout',
  // 已接通(见 15 号 Q-M15):toolNode.protocolFuse 抛出的 `ToolProtocolFuseError` 会携带 errorCode
  TOOL_PROTOCOL_FUSE: 'tool.protocol_fuse',
  // 已接通(见 15 号 Q-M15):childToolContext depth 超限会抛出带 errorCode 的 `ChildRunDepthExceededError`
  ENGINE_DELEGATE_DEPTH: 'engine.delegate_depth_exceeded',
  // 已接通(见 15 号 Q-M15):GraphExecutor 在 maxSteps 用尽时 emit `ErrorEvent.error_code`
  ENGINE_BUDGET_EXHAUSTED: 'engine.budget_exhausted',
  ENGINE_UNKNOWN: 'engine.unknown',
} as const;

export interface ErrorClassification {
  category: ErrorCategory;
  reason: string;
  suggestedDelay: number | null;
  errorCode: string;
  recoverable: boolean;
  retryAfterMs?: number;
  hint?: string;
  metadata?: Record<string, unknown>;
}

type ClassificationExtras = Omit<ErrorClassification, 'category' | 'reason' | 'suggestedDelay'>;
type UnknownRecord = Record<string, unknown>;

const logger = new Logger('ErrorClassifier');

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readNumericHttpStatus(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599) {
    return value;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!/^\d{3}$/.test(trimmed)) {
    return undefined;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return parsed >= 100 && parsed <= 599 ? parsed : undefined;
}

function readHttpStatusFromRecord(record: UnknownRecord): number | undefined {
  const directKeys = ['status', 'statusCode', 'httpStatus', 'http_status', 'responseStatus'];
  for (const key of directKeys) {
    const status = readNumericHttpStatus(record[key]);
    if (status !== undefined) {
      return status;
    }
  }

  const response = record['response'];
  if (isRecord(response)) {
    const status = readHttpStatusFromRecord(response);
    if (status !== undefined) {
      return status;
    }
  }

  const nestedError = record['error'];
  if (isRecord(nestedError)) {
    const status = readHttpStatusFromRecord(nestedError);
    if (status !== undefined) {
      return status;
    }
  }

  return undefined;
}

function readCause(error: Error): unknown {
  return 'cause' in error ? error.cause : undefined;
}

function readCauseMessage(cause: unknown): string {
  if (typeof cause === 'string') return cause.toLowerCase();
  if (cause instanceof Error) return (cause.message || '').toLowerCase();
  if (isRecord(cause) && typeof cause['message'] === 'string') {
    return String(cause['message']).toLowerCase();
  }
  return '';
}

function readCauseCode(cause: unknown): string {
  if (isRecord(cause) && typeof cause['code'] === 'string') {
    return String(cause['code']);
  }
  return '';
}

function readHttpStatus(error: Error, cause: unknown): number | undefined {
  const directStatus = isRecord(error) ? readHttpStatusFromRecord(error) : undefined;
  if (directStatus !== undefined) {
    return directStatus;
  }
  return isRecord(cause) ? readHttpStatusFromRecord(cause) : undefined;
}

function hasStandaloneHttpStatus(errorMessage: string, status: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${status}([^a-z0-9]|$)`).test(errorMessage);
}

function matchesPattern(errorMessage: string, pattern: string): boolean {
  return /^\d{3}$/.test(pattern)
    ? hasStandaloneHttpStatus(errorMessage, pattern)
    : errorMessage.includes(pattern);
}

function logClassification(
  context: { logPrefix?: string } | undefined,
  message: string,
  metadata: Record<string, unknown> = {},
): void {
  logger.debug(message, {
    source: context?.logPrefix ?? 'ErrorClassifier',
    ...metadata,
  });
}

function createClassification(
  category: ErrorCategory,
  reason: string,
  suggestedDelay: number | null,
  extras: ClassificationExtras,
): ErrorClassification {
  return {
    category,
    reason,
    suggestedDelay,
    ...extras,
  };
}

function readStructuredClassification(error: Error): ErrorClassification | undefined {
  if (!isRecord(error)) return undefined;

  const rawErrorCode = error['errorCode'];
  const recoverable = error['recoverable'];
  if (typeof rawErrorCode !== 'string' || rawErrorCode.trim().length === 0) return undefined;
  if (typeof recoverable !== 'boolean') return undefined;

  const errorCode = rawErrorCode.trim();
  const retryAfterMsValue = error['retryAfterMs'];
  const retryAfterMs = typeof retryAfterMsValue === 'number'
    && Number.isFinite(retryAfterMsValue)
    && retryAfterMsValue >= 0
    ? retryAfterMsValue
    : undefined;
  const hintValue = error['hint'];
  const hint = typeof hintValue === 'string' && hintValue.trim().length > 0
    ? hintValue.trim()
    : undefined;
  const metadataValue = error['metadata'];
  const metadata = isRecord(metadataValue) ? metadataValue : undefined;

  return createClassification(
    recoverable ? ErrorCategory.RETRYABLE : ErrorCategory.NON_RETRYABLE,
    `结构化错误: ${errorCode}`,
    recoverable ? retryAfterMs ?? 1000 : null,
    {
      errorCode,
      recoverable,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      ...(hint === undefined ? {} : { hint }),
      ...(metadata === undefined ? {} : { metadata }),
    },
  );
}

export class ErrorClassifier {
  static classify(error: Error, context?: { logPrefix?: string }): ErrorClassification {
    const structured = readStructuredClassification(error);
    if (structured) {
      logClassification(context, '采用错误对象提供的结构化分类', {
        errorCode: structured.errorCode,
        recoverable: structured.recoverable,
      });
      return structured;
    }

    const baseMsg = (error.message || '').toLowerCase();
    const cause = readCause(error);
    const causeMsg = readCauseMessage(cause);
    const causeCode = readCauseCode(cause);
    const httpStatus = readHttpStatus(error, cause);

    const errorMessage = `${baseMsg} ${causeMsg}`.trim();

    if (errorMessage.includes('invalid tool_call.arguments')) {
      logClassification(context, '检测到流式 tool_call 参数损坏，可以重试');
      return createClassification(ErrorCategory.RETRYABLE, '模型输出损坏: invalid tool_call.arguments', 1000, {
        errorCode: ENGINE_ERROR_CODES.LLM_INVALID_TOOL_ARGS,
        recoverable: true,
        retryAfterMs: 1000,
        hint: 'retry_with_same_request',
        metadata: { matchedPattern: 'invalid tool_call.arguments' },
      });
    }

    const unsupportedPatterns = [
      'does not support',
      'not supported',
      'tool calling is not available',
      'feature not available',
      'capability not supported',
      'unsupported',
    ];

    for (const pattern of unsupportedPatterns) {
      if (errorMessage.includes(pattern)) {
        logClassification(context, '检测到功能不支持错误，不重试', { matchedPattern: pattern });
        return createClassification(ErrorCategory.NON_RETRYABLE, `功能不支持: ${pattern}`, null, {
          errorCode: ENGINE_ERROR_CODES.LLM_UNSUPPORTED_CAPABILITY,
          recoverable: false,
          hint: 'switch_model_or_disable_feature',
          metadata: { matchedPattern: pattern },
        });
      }
    }

    const quotaPatterns = ['已达上限', '免费期已结束'];
    for (const pattern of quotaPatterns) {
      if (errorMessage.includes(pattern)) {
        logClassification(context, '检测到云端额度限制，不重试', { matchedPattern: pattern });
        return createClassification(ErrorCategory.NON_RETRYABLE, `云端额度限制: ${pattern}`, null, {
          errorCode: ENGINE_ERROR_CODES.LLM_PROVIDER_DOWN,
          recoverable: false,
          hint: 'check_billing_or_provider_status',
          metadata: { matchedPattern: pattern },
        });
      }
    }

    const authPatterns = [
      { pattern: 'unauthorized', code: '401' },
      { pattern: 'forbidden', code: '403' },
      { pattern: 'invalid api key', code: 'auth' },
      { pattern: 'invalid_api_key', code: 'auth' },
      { pattern: 'authentication failed', code: 'auth' },
      { pattern: 'api key not found', code: 'auth' },
    ];

    for (const { pattern, code } of authPatterns) {
      if (errorMessage.includes(pattern)) {
        logClassification(context, '检测到认证/权限错误，不重试', {
          matchedPattern: pattern,
          authCode: code,
        });
        return createClassification(ErrorCategory.NON_RETRYABLE, `认证/权限错误: ${pattern}`, null, {
          errorCode: ENGINE_ERROR_CODES.LLM_AUTH_FAILED,
          recoverable: false,
          hint: 'check_credentials',
          metadata: { matchedPattern: pattern, authCode: code },
        });
      }
    }

    if (httpStatus === 401 || httpStatus === 403) {
      logClassification(context, '检测到结构化认证/权限 HTTP 状态码，不重试', { httpStatus });
      return createClassification(ErrorCategory.NON_RETRYABLE, `认证/权限错误: HTTP ${httpStatus}`, null, {
        errorCode: ENGINE_ERROR_CODES.LLM_AUTH_FAILED,
        recoverable: false,
        hint: 'check_credentials',
        metadata: { matchedPattern: String(httpStatus), httpStatus },
      });
    }

    if (httpStatus === 400) {
      logClassification(context, '检测到结构化请求格式 HTTP 状态码，不重试', { httpStatus });
      return createClassification(ErrorCategory.NON_RETRYABLE, '请求格式错误: HTTP 400', null, {
        errorCode: ENGINE_ERROR_CODES.LLM_INVALID_REQUEST,
        recoverable: false,
        hint: 'fix_request_payload',
        metadata: { matchedPattern: '400', httpStatus },
      });
    }

    const formatPatterns = [
      'bad request',
      '400',
      'invalid request',
      'invalid parameter',
      'invalid arguments for function',
      'convert_request_failed',
      'validation error',
      'malformed',
      'invalid json',
      'parse error',
      'schema validation failed',
    ];

    for (const pattern of formatPatterns) {
      if (matchesPattern(errorMessage, pattern)) {
        logClassification(context, '检测到请求格式错误，不重试', { matchedPattern: pattern });
        return createClassification(ErrorCategory.NON_RETRYABLE, `请求格式错误: ${pattern}`, null, {
          errorCode: ENGINE_ERROR_CODES.LLM_INVALID_REQUEST,
          recoverable: false,
          hint: 'fix_request_payload',
          metadata: { matchedPattern: pattern },
        });
      }
    }

    const notFoundPatterns = [
      'not found',
      '404',
      'model not found',
      'endpoint not found',
      'resource not found',
    ];

    if (httpStatus === 404) {
      logClassification(context, '检测到结构化资源不存在 HTTP 状态码，不重试', { httpStatus });
      return createClassification(ErrorCategory.NON_RETRYABLE, '资源不存在: HTTP 404', null, {
        errorCode: ENGINE_ERROR_CODES.LLM_RESOURCE_NOT_FOUND,
        recoverable: false,
        hint: 'verify_resource_identifier',
        metadata: { matchedPattern: '404', httpStatus },
      });
    }

    for (const pattern of notFoundPatterns) {
      if (matchesPattern(errorMessage, pattern)) {
        logClassification(context, '检测到资源不存在错误，不重试', { matchedPattern: pattern });
        return createClassification(ErrorCategory.NON_RETRYABLE, `资源不存在: ${pattern}`, null, {
          errorCode: ENGINE_ERROR_CODES.LLM_RESOURCE_NOT_FOUND,
          recoverable: false,
          hint: 'verify_resource_identifier',
          metadata: { matchedPattern: pattern },
        });
      }
    }

    const rateLimitPatterns = [
      'rate limit',
      'too many requests',
      '429',
      'quota exceeded',
      'throttled',
    ];

    if (httpStatus === 429) {
      logClassification(context, '检测到结构化速率限制 HTTP 状态码，将使用指数退避重试', {
        httpStatus,
      });
      return createClassification(ErrorCategory.RATE_LIMIT, '速率限制: HTTP 429', 1000, {
        errorCode: ENGINE_ERROR_CODES.LLM_RATE_LIMIT,
        recoverable: true,
        retryAfterMs: 1000,
        hint: 'retry_with_backoff',
        metadata: { matchedPattern: '429', httpStatus },
      });
    }

    for (const pattern of rateLimitPatterns) {
      if (matchesPattern(errorMessage, pattern)) {
        logClassification(context, '检测到速率限制错误，将使用指数退避重试', {
          matchedPattern: pattern,
        });
        return createClassification(ErrorCategory.RATE_LIMIT, `速率限制: ${pattern}`, 1000, {
          errorCode: ENGINE_ERROR_CODES.LLM_RATE_LIMIT,
          recoverable: true,
          retryAfterMs: 1000,
          hint: 'retry_with_backoff',
          metadata: { matchedPattern: pattern },
        });
      }
    }

    const networkPatterns = [
      'network error',
      'timeout',
      'econnrefused',
      'econnreset',
      'etimedout',
      'connection refused',
      'connection reset',
      'socket hang up',
      'fetch failed',
      'network timeout',
      'other side closed',
    ];

    /**
     * undici 在响应流被对端中止时使用固定形状 `TypeError('terminated')`。
     * 不能把 `terminated` 当全文关键词，否则本地进程终态、断言和业务错误都会被误报成供应商故障，
     * 继而触发本不该发生的模型重试。
     */
    if (error instanceof TypeError && baseMsg.trim() === 'terminated') {
      logClassification(context, '检测到 undici 响应流中止，可以重试', {
        matchedPattern: 'TypeError: terminated',
      });
      return createClassification(ErrorCategory.RETRYABLE, '网络错误: terminated', 1000, {
        errorCode: ENGINE_ERROR_CODES.LLM_PROVIDER_DOWN,
        recoverable: true,
        retryAfterMs: 1000,
        hint: 'retry_with_backoff',
        metadata: { matchedPattern: 'terminated' },
      });
    }

    for (const pattern of networkPatterns) {
      if (errorMessage.includes(pattern)) {
        logClassification(context, '检测到网络错误，可以重试', { matchedPattern: pattern });
        return createClassification(ErrorCategory.RETRYABLE, `网络错误: ${pattern}`, 1000, {
          errorCode: ENGINE_ERROR_CODES.LLM_PROVIDER_DOWN,
          recoverable: true,
          retryAfterMs: 1000,
          hint: 'retry_with_backoff',
          metadata: { matchedPattern: pattern },
        });
      }
    }

    if (causeCode.startsWith('UND_ERR_')) {
      logClassification(context, '检测到 undici 错误码，可以重试', { causeCode });
      return createClassification(ErrorCategory.RETRYABLE, `网络错误(undici): ${causeCode}`, 1000, {
        errorCode: ENGINE_ERROR_CODES.LLM_PROVIDER_DOWN,
        recoverable: true,
        retryAfterMs: 1000,
        hint: 'retry_with_backoff',
        metadata: { matchedPattern: causeCode },
      });
    }

    const serverErrorPatterns = [
      { pattern: '500', name: 'Internal Server Error' },
      { pattern: '502', name: 'Bad Gateway' },
      { pattern: '503', name: 'Service Unavailable' },
      { pattern: '504', name: 'Gateway Timeout' },
      { pattern: 'internal server error', name: 'Internal Server Error' },
      { pattern: 'bad gateway', name: 'Bad Gateway' },
      { pattern: 'service unavailable', name: 'Service Unavailable' },
      { pattern: 'gateway timeout', name: 'Gateway Timeout' },
    ];

    if (httpStatus !== undefined && httpStatus >= 500 && httpStatus <= 599) {
      logClassification(context, '检测到结构化服务端临时 HTTP 状态码，可以重试', {
        httpStatus,
      });
      return createClassification(ErrorCategory.RETRYABLE, `服务端临时错误: HTTP ${httpStatus}`, 2000, {
        errorCode: ENGINE_ERROR_CODES.LLM_PROVIDER_DOWN,
        recoverable: true,
        retryAfterMs: 2000,
        hint: 'retry_with_backoff',
        metadata: { matchedPattern: String(httpStatus), httpStatus },
      });
    }

    for (const { pattern, name } of serverErrorPatterns) {
      if (matchesPattern(errorMessage, pattern)) {
        logClassification(context, '检测到服务端临时错误，可以重试', {
          matchedPattern: pattern,
          name,
        });
        return createClassification(ErrorCategory.RETRYABLE, `服务端临时错误: ${name}`, 2000, {
          errorCode: ENGINE_ERROR_CODES.LLM_PROVIDER_DOWN,
          recoverable: true,
          retryAfterMs: 2000,
          hint: 'retry_with_backoff',
          metadata: { matchedPattern: pattern },
        });
      }
    }

    if (errorMessage.includes('空响应') || errorMessage.includes('empty response')) {
      logClassification(context, '检测到空响应错误，可以重试');
      return createClassification(ErrorCategory.RETRYABLE, '空响应错误', 1000, {
        errorCode: ENGINE_ERROR_CODES.LLM_PROVIDER_DOWN,
        recoverable: true,
        retryAfterMs: 1000,
        hint: 'retry_with_backoff',
        metadata: { matchedPattern: 'empty response' },
      });
    }

    const truncatedMessage =
      errorMessage.length > 100 ? `${errorMessage.substring(0, 100)}...` : errorMessage;

    logClassification(context, '未知错误类型，默认不重试以避免浪费', {
      message: truncatedMessage,
    });
    return createClassification(ErrorCategory.NON_RETRYABLE, '未知错误类型（保守策略）', null, {
      errorCode: ENGINE_ERROR_CODES.ENGINE_UNKNOWN,
      recoverable: false,
      hint: 'inspect_logs',
      metadata: { matchedPattern: 'fallback' },
    });
  }

  static categorize(error: Error): ErrorCategory {
    return this.classify(error).category;
  }

  static shouldRetry(error: Error): boolean {
    const category = this.categorize(error);
    return category === ErrorCategory.RETRYABLE || category === ErrorCategory.RATE_LIMIT;
  }

  static calculateRetryDelay(
    errorOrClassification: Error | ErrorClassification,
    attemptNumber: number,
    baseDelay: number = 1000,
    maxDelay: number = 60000,
  ): number {
    const classification = errorOrClassification instanceof Error
      ? this.classify(errorOrClassification)
      : errorOrClassification;

    if (classification.category === ErrorCategory.NON_RETRYABLE) {
      return 0;
    }

    if (classification.category === ErrorCategory.RATE_LIMIT) {
      return Math.min(baseDelay * Math.pow(2, attemptNumber), maxDelay);
    }

    return classification.suggestedDelay || baseDelay;
  }

  static isCloudQuotaError(error: Error): boolean {
    const msg = (error.message || '').toLowerCase();
    const patterns = [
      '额度上限',
      '已达上限',
      '免费期已结束',
      '该模型暂不可用',
      'cloud_quota_exhausted',
    ];
    return patterns.some((pattern) => msg.includes(pattern));
  }
}

export const classifyError = (error: Error) => ErrorClassifier.classify(error);
export const categorizeError = (error: Error) => ErrorClassifier.categorize(error);
export const shouldRetryError = (error: Error) => ErrorClassifier.shouldRetry(error);
