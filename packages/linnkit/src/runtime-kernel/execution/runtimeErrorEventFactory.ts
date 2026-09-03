import { ENGINE_ERROR_CODES, ErrorClassifier } from '../../shared/errorClassifier';
import type { ErrorEvent } from '../../contracts';
import { createErrorEvent, toSerializableJsonValue } from '../../contracts';

type UnknownRecord = Record<string, unknown>;

const isRecord = (v: unknown): v is UnknownRecord => !!v && typeof v === 'object' && !Array.isArray(v);

function safeJsonParse(text: string): unknown | undefined {
  const t = text.trim();
  if (!t) return undefined;
  if (!(t.startsWith('{') || t.startsWith('['))) return undefined;
  try {
    return JSON.parse(t) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * 提取“嵌套 JSON 字符串”形态的上游错误信息。
 *
 * 典型示例（来自日志）：
 * - Error.message 是 JSON 字符串（外层），其中 `error.message` 又是一段 JSON 字符串（内层 provider/router）。
 */
export function extractNestedProviderError(rawMessage: string): {
  outer?: unknown;
  inner?: unknown;
  innerType?: string;
  httpStatus?: number;
  innerMessage?: string;
} {
  const outer = safeJsonParse(rawMessage);
  if (!isRecord(outer)) return {};

  const outerError = outer['error'];
  if (!isRecord(outerError)) return { outer };

  const innerMessageText = outerError['message'];
  if (typeof innerMessageText !== 'string') return { outer };

  const inner = safeJsonParse(innerMessageText);
  if (!isRecord(inner)) return { outer, inner: innerMessageText };

  const innerType = typeof inner['type'] === 'string' ? inner['type'] : undefined;
  const httpStatus = typeof inner['httpStatus'] === 'number' ? inner['httpStatus'] : undefined;
  const innerMessage = typeof inner['message'] === 'string' ? inner['message'] : undefined;

  return { outer, inner, innerType, httpStatus, innerMessage };
}

export interface CreateRuntimeErrorEventInput {
  /** 由事实 owner 在调用本工厂前创建的稳定 Runtime event ID。 */
  id: string;
  conversationId: string;
  turnId: string;
  error: unknown;
  /**
   * 事件来源，用于排查（不会直接展示给用户）。
   */
  source?: string;
  /**
   * 可选：覆盖 error_code，用于保留业务错误的稳定分类。
   */
  errorCode?: string;
  /**
   * 可选：覆盖 retryable。
   */
  retryable?: boolean;
  /**
   * 可选：覆盖 error 文本（默认使用原始 error.message）。
   * 注意：这不是“用户友好化文案”，只是允许在系统级错误里加上更明确的上下文前缀。
   */
  errorText?: string;
  /**
   * 可选：合并到 details 的附加字段（便于调用方补充上下文信息）。
   */
  detailsPatch?: Record<string, unknown>;
}

export type ClassifiedRuntimeErrorEvent = ErrorEvent & {
  error_code: string;
  retryable: boolean;
};

/**
 * 统一创建 RuntimeEvent(type='error')。
 *
 * 中文备注：
 * - `error` 字段保留原始 message（前端负责友好化）；
 * - `error_code` 尽量稳定：优先上游结构化 type，否则 fallback 到分类结果；
 * - `retryable` 与 `details.classification` 使用同一份 classifier 输出，避免重复判断。
 */
export function createRuntimeErrorEvent(input: CreateRuntimeErrorEventInput): ClassifiedRuntimeErrorEvent {
  const rawMessage = input.error instanceof Error ? input.error.message : String(input.error);
  const errObj = input.error instanceof Error ? input.error : new Error(rawMessage);

  const nested = extractNestedProviderError(rawMessage);
  const classification = ErrorClassifier.classify(errObj, { logPrefix: '[RuntimeErrorEventFactory]' });

  const errorCodeComputed =
    (nested.innerType && nested.innerType.trim().length > 0 ? nested.innerType.trim() : undefined) ??
    (classification.errorCode && classification.errorCode.trim().length > 0
      ? classification.errorCode
      : undefined) ??
    ENGINE_ERROR_CODES.ENGINE_UNKNOWN;

  const errorTextComputed = rawMessage && rawMessage.trim().length > 0 ? rawMessage : 'Unknown error';
  const errorText = (input.errorText && input.errorText.trim().length > 0 ? input.errorText.trim() : undefined) ?? errorTextComputed;
  const errorCode = (input.errorCode && input.errorCode.trim().length > 0 ? input.errorCode.trim() : undefined) ?? errorCodeComputed;
  const retryable =
    typeof input.retryable === 'boolean' ? input.retryable : classification.recoverable;

  const event = createErrorEvent(
    input.id,
    input.conversationId,
    input.turnId,
    errorText,
    {
      error_code: errorCode,
      retryable,
      details: toSerializableJsonValue({
        source: input.source,
        name: input.error instanceof Error ? input.error.name : undefined,
        stack: input.error instanceof Error ? input.error.stack : undefined,
        raw_message: rawMessage,
        nested,
        classification,
        ...(input.detailsPatch ? input.detailsPatch : {}),
      }),
    }
  );
  return {
    ...event,
    error_code: errorCode,
    retryable,
  };
}
