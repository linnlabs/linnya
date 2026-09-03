/**
 * @file apps/renderer/domains/conversation/services/errorNormalizer.ts
 * @description 会话错误友好化（前端统一入口）
 *
 * 设计目标：
 * - 将后端推送的 SSE error（或网络层构造的 error）转换为当前语言的用户友好文案；
 * - 同时保留原始技术信息，便于排查（但不直接展示给用户）。
 *
 * 注意：
 * - 这是“语义层”的稳定转换，不依赖 UI 组件，不应产生副作用。
 * - 严禁使用 any 类型断言；通过类型守卫读取字段。
 */

import { ConversationImageAttachmentErrorCodeSchema } from '@app/schemas';
import { CONVERSATION_MESSAGE_FALLBACKS } from '../definitions/conversationMessageCatalog';
import type { ConversationMessageKey, ConversationMessageResolver } from '../definitions/conversationMessages';
import { resolveImageAttachmentErrorMessage } from '../features/image-attachments';

export interface NormalizedUserFacingError {
  /** 给用户看的简洁中文文案 */
  userMessage: string;
  /** 机器可读错误码（可选） */
  errorCode?: string;
  /** 是否可重试（可选） */
  retryable?: boolean;
  /** 原始错误信息（技术细节，供日志/排查） */
  rawMessage?: string;
  /** 后端按同一次输入 requirement 算出的兼容模型候选。 */
  compatibleModelIds?: readonly string[];
  /** 当前请求实际需要、但 route 无法承载的图片来源。 */
  requiredImagePlacements?: readonly ImageInputPlacement[];
}

/**
 * HTTP 层错误（非 SSE）统一归一化结果。
 * - userMessage：给用户看的
 * - details：给排查用（不会直接展示）
 */
export interface NormalizedHttpError extends NormalizedUserFacingError {
  details: {
    status: number;
    statusText?: string;
    /** 仅保留截断后的 bodyText，避免把大响应塞进内存/日志 */
    bodyText: string;
  };
}

type UnknownRecord = Record<string, unknown>;
type ImageInputPlacement = 'user_image' | 'tool_result_image';
type ErrorNormalizerOptions = {
  resolveMessage?: ConversationMessageResolver;
};

const isRecord = (v: unknown): v is UnknownRecord => !!v && typeof v === 'object' && !Array.isArray(v);

const getString = (obj: UnknownRecord, key: string): string | undefined => {
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
};

const hasSubstring = (text: string | undefined, needle: string): boolean => {
  if (!text) return false;
  return text.toLowerCase().includes(needle.toLowerCase());
};

function readErrorMetadata(event: UnknownRecord): UnknownRecord | undefined {
  const details = event['details'];
  if (!isRecord(details)) return undefined;

  const directMetadata = details['metadata'];
  const classification = details['classification'];
  const classificationMetadata = isRecord(classification)
    ? classification['metadata']
    : undefined;
  return isRecord(directMetadata)
    ? directMetadata
    : isRecord(classificationMetadata)
      ? classificationMetadata
      : undefined;
}

function readCompatibleModelIds(event: UnknownRecord): string[] | undefined {
  const metadata = readErrorMetadata(event);
  if (!metadata) return undefined;

  const value = metadata['compatible_model_ids'];
  if (!Array.isArray(value)) return undefined;
  const uniqueIds = [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(item => item.length > 0))];
  return uniqueIds.length > 0 ? uniqueIds : undefined;
}

function readRequiredImagePlacements(event: UnknownRecord): ImageInputPlacement[] | undefined {
  const metadata = readErrorMetadata(event);
  if (!metadata) return undefined;
  const value = metadata['required_placements'];
  if (!Array.isArray(value)) return undefined;
  const placements = [...new Set(value.filter(
    (item): item is ImageInputPlacement =>
      item === 'user_image' || item === 'tool_result_image',
  ))];
  return placements.length > 0 ? placements : undefined;
}

function resolveImagePlacementErrorMessageKey(input: {
  readonly placements: readonly ImageInputPlacement[] | undefined;
  readonly hasAlternatives: boolean;
}): ConversationMessageKey {
  if (input.placements?.length === 1 && input.placements[0] === 'user_image') {
    return input.hasAlternatives
      ? 'conversation.error.userImagePlacementUnsupportedWithAlternatives'
      : 'conversation.error.userImagePlacementUnsupported';
  }
  if (input.placements?.length === 1 && input.placements[0] === 'tool_result_image') {
    return input.hasAlternatives
      ? 'conversation.error.toolResultImagePlacementUnsupportedWithAlternatives'
      : 'conversation.error.toolResultImagePlacementUnsupported';
  }
  return input.hasAlternatives
    ? 'conversation.error.imagePlacementUnsupportedWithAlternatives'
    : 'conversation.error.imagePlacementUnsupported';
}

function resolveErrorMessage(
  key: ConversationMessageKey,
  options?: ErrorNormalizerOptions,
  params?: Parameters<ConversationMessageResolver>[1],
): string {
  return options?.resolveMessage
    ? options.resolveMessage(key, params)
    : CONVERSATION_MESSAGE_FALLBACKS[key];
}

function getImageInputErrorMessageKey(errorCode: string): ConversationMessageKey | undefined {
  switch (errorCode) {
    case 'llm.image_input.attachment_unavailable':
      return 'conversation.error.imageAttachmentUnavailable';
    case 'llm.image_input.attachment_integrity_failed':
      return 'conversation.error.imageAttachmentIntegrityFailed';
    case 'llm.image_input.route_limit_exceeded':
      return 'conversation.error.imageRouteLimitExceeded';
    case 'llm.image_input.mapping_unsupported':
      return 'conversation.error.imageMappingUnsupported';
    case 'llm.image_input.context_budget_exceeded':
      return 'conversation.error.imageContextBudgetExceeded';
    default:
      return undefined;
  }
}

function readStructuredHttpStatus(errorCode: string | undefined): number | undefined {
  if (!errorCode) return undefined;
  const match = /^(?:http_|(?:llm\.)?provider_http_)(\d{3})$/i.exec(errorCode.trim());
  if (!match) return undefined;
  const status = Number(match[1]);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
}

const extractRawMessageFromHttpBody = (bodyText: string): string | undefined => {
  if (!bodyText) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;

  // 兼容常见错误结构：
  // - { error: { message: string } }
  // - { message: string }
  // - { error: string }
  const msg = getString(parsed, 'message');
  if (msg && msg.trim()) return msg.trim();

  const err = parsed['error'];
  if (typeof err === 'string' && err.trim()) return err.trim();
  if (isRecord(err)) {
    const nested = getString(err, 'message');
    if (nested && nested.trim()) return nested.trim();
  }
  return undefined;
};

/**
 * 将 HTTP 非 2xx（或网络层判定失败）的响应信息转换为用户友好错误。
 * 注意：这是纯函数，不读取 Response，不做 IO。
 */
export function normalizeHttpErrorPayload(input: {
  status: number;
  statusText?: string;
  bodyText?: string;
}, options?: ErrorNormalizerOptions): NormalizedHttpError {
  const status = input.status;
  const statusText = input.statusText;
  const bodyText = typeof input.bodyText === 'string' ? input.bodyText : '';
  const rawMessage = extractRawMessageFromHttpBody(bodyText);

  // 用户友好文案（不把供应商/协议细节直接甩给用户）
  const userMessage = (() => {
    if (status === 429) {
      return resolveErrorMessage('conversation.error.rateLimit', options);
    }
    if (status >= 500) {
      return resolveErrorMessage('conversation.error.serviceUnavailable', options);
    }
    if (status === 400) {
      return resolveErrorMessage('conversation.error.badRequest', options);
    }
    if (status === 401 || status === 403) {
      // 云端额度限制也用 403，需要识别出来给用户友好提示
      if (hasSubstring(rawMessage, '已达上限') || hasSubstring(rawMessage, '免费期已结束')) {
        return resolveErrorMessage('conversation.error.quotaExceeded', options);
      }
      return resolveErrorMessage('conversation.error.auth', options);
    }
    // 其他：尽量保持中性，不泄露实现细节
    return resolveErrorMessage('conversation.error.requestFailed', options);
  })();

  return {
    userMessage,
    errorCode: `HTTP_${status}`,
    retryable: status === 429 || status === 408 || status === 409 || status >= 500,
    rawMessage,
    details: {
      status,
      statusText,
      bodyText: bodyText ? bodyText.slice(0, 2000) : '',
    },
  };
}

/**
 * 将“可能是 SSEErrorEvent 的对象”转换为用户友好错误。
 */
export function normalizeConversationError(
  event: unknown,
  options?: ErrorNormalizerOptions,
): NormalizedUserFacingError {
  if (!isRecord(event)) {
    return { userMessage: resolveErrorMessage('conversation.error.generic', options) };
  }

  const rawMessage =
    getString(event, 'error') ??
    getString(event, 'message') ??
    undefined;

  const errorCode = getString(event, 'error_code') ?? getString(event, 'code') ?? undefined;
  const retryableValue = event['retryable'];
  const retryable = typeof retryableValue === 'boolean' ? retryableValue : undefined;
  const normalizedErrorCode = errorCode?.trim().toLowerCase() ?? '';
  const compatibleModelIds = readCompatibleModelIds(event);
  const requiredImagePlacements = readRequiredImagePlacements(event);

  const imageAttachmentErrorCode = ConversationImageAttachmentErrorCodeSchema.safeParse(
    normalizedErrorCode,
  );
  if (imageAttachmentErrorCode.success) {
    return {
      userMessage: resolveErrorMessage(
        resolveImageAttachmentErrorMessage(imageAttachmentErrorCode.data),
        options,
      ),
      errorCode,
      retryable: retryable ?? false,
      rawMessage,
    };
  }

  if (normalizedErrorCode === 'llm.image_input.model_unsupported') {
    const userMessage = compatibleModelIds
      ? resolveErrorMessage(
          'conversation.error.imageModelUnsupportedWithAlternatives',
          options,
          { models: compatibleModelIds.join(', ') },
        )
      : resolveErrorMessage('conversation.error.imageModelUnsupported', options);
    return {
      userMessage,
      errorCode,
      retryable: retryable ?? false,
      rawMessage,
      compatibleModelIds,
    };
  }

  if (normalizedErrorCode === 'llm.image_input.placement_unsupported') {
    const messageKey = resolveImagePlacementErrorMessageKey({
      placements: requiredImagePlacements,
      hasAlternatives: compatibleModelIds !== undefined,
    });
    const userMessage = compatibleModelIds
      ? resolveErrorMessage(
          messageKey,
          options,
          { models: compatibleModelIds.join(', ') },
        )
      : resolveErrorMessage(messageKey, options);
    return {
      userMessage,
      errorCode,
      retryable: retryable ?? false,
      rawMessage,
      compatibleModelIds,
      requiredImagePlacements,
    };
  }

  if (normalizedErrorCode === 'llm.image_input.materialization_pending') {
    return {
      userMessage: resolveErrorMessage('conversation.error.imageMaterializationPending', options),
      errorCode,
      retryable: retryable ?? false,
      rawMessage,
    };
  }

  const imageInputMessageKey = getImageInputErrorMessageKey(normalizedErrorCode);
  if (imageInputMessageKey) {
    return {
      userMessage: resolveErrorMessage(imageInputMessageKey, options),
      errorCode,
      retryable: retryable ?? false,
      rawMessage,
    };
  }

  // 少数供应商尚未给这两类错误独立结构码，只保留语义明确的短语识别。
  const isThinkingProtocolMismatch = (
    normalizedErrorCode.includes('thinking_protocol_mismatch')
    || hasSubstring(rawMessage, 'expected `thinking`')
    || hasSubstring(rawMessage, 'expected thinking')
    || hasSubstring(rawMessage, 'redacted_thinking')
  );
  if (isThinkingProtocolMismatch) {
    return {
      userMessage: resolveErrorMessage('conversation.error.thinkingProtocolMismatch', options),
      errorCode: errorCode ?? 'THINKING_PROTOCOL_MISMATCH',
      retryable: retryable ?? false,
      rawMessage,
    };
  }

  if (normalizedErrorCode === 'llm.output_limit_reached') {
    return {
      userMessage: resolveErrorMessage('conversation.error.outputLimitReached', options),
      errorCode,
      retryable: false,
      rawMessage,
    };
  }

  if (normalizedErrorCode === 'llm.content_filtered') {
    return {
      userMessage: resolveErrorMessage('conversation.error.contentFiltered', options),
      errorCode,
      retryable: false,
      rawMessage,
    };
  }

  const isQuotaExceeded = (
    normalizedErrorCode.includes('quota_exceeded')
    || normalizedErrorCode.includes('insufficient_quota')
    || hasSubstring(rawMessage, '已达上限')
    || hasSubstring(rawMessage, '免费期已结束')
  );
  if (isQuotaExceeded) {
    return {
      userMessage: resolveErrorMessage('conversation.error.quotaExceeded', options),
      errorCode: errorCode ?? 'QUOTA_EXCEEDED',
      retryable: false,
      rawMessage,
    };
  }

  /**
   * 0) HTTP 错误码友好化（来自网络层 normalizeHttpErrorPayload → SSEErrorEvent.error_code=HTTP_xxx）
   *
   * 中文备注：
   * - 这类错误通常已经在 `SSEErrorEvent.error` 里放了友好文案；
   * - 但为了避免未来某处只传了 error_code（或 rawMessage 偏技术），这里补齐基于 status 的稳定映射。
   */
  const httpStatus = readStructuredHttpStatus(errorCode);
  if (typeof httpStatus === 'number') {
    const userMessage = (() => {
      if (httpStatus === 429) {
        return normalizedErrorCode.includes('provider_http_')
          ? resolveErrorMessage('conversation.error.providerLimit', options)
          : resolveErrorMessage('conversation.error.rateLimit', options);
      }
      if (httpStatus === 502) {
        return resolveErrorMessage('conversation.error.http502', options);
      }
      if (httpStatus === 503) {
        return resolveErrorMessage('conversation.error.http503', options);
      }
      if (httpStatus === 504) {
        return resolveErrorMessage('conversation.error.http504', options);
      }
      if (httpStatus >= 500) {
        return resolveErrorMessage('conversation.error.serviceUnavailable', options);
      }
      if (httpStatus === 400) {
        return resolveErrorMessage('conversation.error.badRequest', options);
      }
      if (httpStatus === 401 || httpStatus === 403) {
        return resolveErrorMessage('conversation.error.auth', options);
      }
      return resolveErrorMessage('conversation.error.requestFailed', options);
    })();

    return {
      userMessage,
      errorCode,
      retryable: retryable ?? (httpStatus === 429 || httpStatus === 408 || httpStatus === 409 || httpStatus >= 500),
      rawMessage,
    };
  }

  // 运行时 error classifier 与 HTTP 层都提供结构化错误码；普通正文不得参与分类。
  if (
    normalizedErrorCode.includes('provider_unavailable')
    || normalizedErrorCode.includes('provider_down')
  ) {
    return {
      userMessage: resolveErrorMessage('conversation.error.providerUnavailable', options),
      errorCode,
      retryable: retryable ?? true,
      rawMessage,
    };
  }

  if (
    normalizedErrorCode.includes('rate_limit')
    || normalizedErrorCode.includes('too_many_requests')
  ) {
    return {
      userMessage: resolveErrorMessage('conversation.error.rateLimit', options),
      errorCode,
      retryable: retryable ?? true,
      rawMessage,
    };
  }

  if (
    normalizedErrorCode.includes('auth_failed')
    || normalizedErrorCode.includes('authentication_failed')
    || normalizedErrorCode.includes('invalid_api_key')
  ) {
    return {
      userMessage: resolveErrorMessage('conversation.error.auth', options),
      errorCode,
      retryable: retryable ?? false,
      rawMessage,
    };
  }

  if (
    normalizedErrorCode.includes('invalid_request')
    || normalizedErrorCode.includes('bad_request')
  ) {
    return {
      userMessage: resolveErrorMessage('conversation.error.badRequest', options),
      errorCode,
      retryable: retryable ?? false,
      rawMessage,
    };
  }

  // 默认：后端 raw error 只作为诊断保留，不直接进入 ErrorBanner。
  return {
    userMessage: resolveErrorMessage('conversation.error.generic', options),
    errorCode,
    retryable,
    rawMessage,
  };
}
