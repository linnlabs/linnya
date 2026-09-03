import {
  AISDKError,
  APICallError,
  EmptyResponseBodyError,
  InvalidResponseDataError,
  JSONParseError,
  StreamProviderError,
  TypeValidationError,
  UnsupportedFunctionalityError,
} from 'ai';
import { AI_SDK_MODEL_ROUTABLE_FAILURE_CODES } from '../../../definitions/aiSdkCapabilityIds';
import type {
  AiSdkFailurePhase,
  AiSdkFailureProjection,
  AiSdkProviderFailureClassifier,
} from '../definitions/aiSdkFailureProjection';
import { AiSdkHostStreamInvariantError } from '../definitions/aiSdkHostStreamInvariantError';

function retryableStatus(statusCode: number | undefined): boolean {
  return (
    statusCode === 408 ||
    statusCode === 409 ||
    statusCode === 429 ||
    (statusCode !== undefined && statusCode >= 500)
  );
}

function classifyProviderSemanticFailure(error: APICallError): string | undefined {
  const body = error.responseBody?.toLowerCase() ?? '';
  if (
    body.includes('user location is not supported') ||
    body.includes('location is not supported') ||
    body.includes('not available in your region') ||
    body.includes('not available in your country')
  ) {
    return AI_SDK_MODEL_ROUTABLE_FAILURE_CODES.PROVIDER_LOCATION_RESTRICTED;
  }
  if (
    body.includes('missing a `thought_signature`') ||
    body.includes('missing a thought_signature') ||
    body.includes('reasoning details to be preserved') ||
    body.includes('preserving-reasoning-blocks')
  ) {
    return AI_SDK_MODEL_ROUTABLE_FAILURE_CODES.PROVIDER_CONTINUATION_REJECTED;
  }
  return undefined;
}

interface StructuredProviderError {
  readonly status?: number;
  readonly code?: string;
  readonly type?: string;
  readonly reason?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value.toLowerCase() : undefined;
}

function readHttpStatus(value: unknown): number | undefined {
  const status = typeof value === 'string' && /^\d{3}$/u.test(value) ? Number(value) : value;
  return typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599
    ? status
    : undefined;
}

/**
 * OpenAI-compatible 等 SDK 的流式 error chunk 会直接暴露已经解析后的普通对象，
 * 不再包装成 APICallError。这里只读取无敏感语义的判别字段，绝不读取 message。
 */
function readStructuredProviderError(error: unknown): StructuredProviderError | undefined {
  if (StreamProviderError.isInstance(error)) {
    const code =
      typeof error.code === 'number'
        ? String(error.code)
        : typeof error.code === 'string' && error.code.length > 0
          ? error.code.toLowerCase()
          : undefined;
    const type =
      typeof error.type === 'string' && error.type.length > 0
        ? error.type.toLowerCase()
        : undefined;
    return {
      ...(error.statusCode === undefined ? {} : { status: error.statusCode }),
      ...(code === undefined ? {} : { code }),
      ...(type === undefined ? {} : { type }),
    };
  }
  if (!isRecord(error) || error instanceof Error) return undefined;
  const record = error;
  const status = readHttpStatus(record.status ?? record.status_code);
  const code = readOptionalString(record, 'code');
  const type = readOptionalString(record, 'type');
  const message = record.message;
  if (typeof message === 'string' && message.length > 0) {
    return {
      ...(status === undefined ? {} : { status }),
      ...(code === undefined ? {} : { code }),
      ...(type === undefined ? {} : { type }),
    };
  }

  // @ai-sdk/openai 在 Responses 流已经产生输出后，会把 response.failed 作为嵌套普通对象交给 Core。
  // 这里只读取 SDK 已解码的判别字段；Provider message 仍不进入 canonical failure 或日志。
  if (type !== 'response.failed') return undefined;
  const response = isRecord(record.response) ? record.response : undefined;
  const responseError = response && isRecord(response.error) ? response.error : undefined;
  const incompleteDetails =
    response && isRecord(response.incomplete_details) ? response.incomplete_details : undefined;
  const nestedCode = responseError ? readOptionalString(responseError, 'code') : undefined;
  const reason = incompleteDetails ? readOptionalString(incompleteDetails, 'reason') : undefined;
  const nestedStatus = readHttpStatus(nestedCode);
  return {
    type,
    ...(nestedStatus === undefined ? {} : { status: nestedStatus }),
    ...(nestedCode === undefined ? {} : { code: nestedCode }),
    ...(reason === undefined ? {} : { reason }),
  };
}

function classifyStructuredProviderError(error: StructuredProviderError): AiSdkFailureProjection {
  // AI SDK 7 会从 response.failed 的 message 推断出 500；canonical code 仍按流中途失败语义保持稳定。
  if (error.type === 'response.failed' && (error.status === undefined || error.status >= 500)) {
    return { kind: 'provider', code: 'provider_stream_unavailable', retryable: true };
  }
  if (error.status !== undefined) {
    return {
      kind: 'provider',
      code: `provider_http_${error.status}`,
      retryable: retryableStatus(error.status),
    };
  }
  const discriminator = `${error.type ?? ''} ${error.code ?? ''} ${error.reason ?? ''}`;
  if (/(insufficient[_ -]?quota)/u.test(discriminator)) {
    return { kind: 'provider', code: 'provider_quota_exhausted', retryable: false };
  }
  if (/(rate[_ -]?limit|too[_ -]?many[_ -]?requests)/u.test(discriminator)) {
    return { kind: 'provider', code: 'provider_stream_rate_limited', retryable: true };
  }
  if (
    /(overload|server[_ -]?error|service[_ -]?unavailable|upstream[_ -]?error)/u.test(discriminator)
  ) {
    return { kind: 'provider', code: 'provider_stream_unavailable', retryable: true };
  }
  if (/(timeout|timed[_ -]?out)/u.test(discriminator)) {
    return { kind: 'provider', code: 'provider_stream_timeout', retryable: true };
  }
  if (/(authentication)/u.test(discriminator)) {
    return { kind: 'provider', code: 'provider_http_401', retryable: false };
  }
  if (/(permission)/u.test(discriminator)) {
    return { kind: 'provider', code: 'provider_http_403', retryable: false };
  }
  if (/(not[_ -]?found)/u.test(discriminator)) {
    return { kind: 'provider', code: 'provider_http_404', retryable: false };
  }
  if (/(invalid|bad[_ -]?request|context[_ -]?length)/u.test(discriminator)) {
    return { kind: 'provider', code: 'provider_http_400', retryable: false };
  }
  return { kind: 'provider', code: 'provider_stream_error', retryable: false };
}

export function classifyAiSdkFailure(
  error: unknown,
  signal: AbortSignal | undefined,
  phase: AiSdkFailurePhase = 'provider_call',
  providerClassifier?: AiSdkProviderFailureClassifier
): AiSdkFailureProjection {
  if (signal?.aborted) {
    return { kind: 'aborted', code: 'request_aborted', retryable: false };
  }
  if (error instanceof AiSdkHostStreamInvariantError) {
    return { kind: 'protocol', code: 'provider_stream_lifecycle_invalid', retryable: false };
  }
  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    const hostProjection = providerClassifier?.classify({
      phase,
      kind: 'api_call',
      ...(status === undefined ? {} : { status_code: status }),
      ...(error.responseBody === undefined ? {} : { response_body: error.responseBody }),
    });
    if (hostProjection !== undefined) {
      return hostProjection;
    }
    const semanticFailure = classifyProviderSemanticFailure(error);
    if (semanticFailure !== undefined) {
      return { kind: 'provider', code: semanticFailure, retryable: false };
    }
    // AI SDK 把尚未取得 HTTP response 的 fetch 失败包装为无 status 的 APICallError，
    // 并用 isRetryable 保留 transport 语义。这里只接纳这一个显式信号；已有 HTTP
    // status 的请求仍由 Linnkit 的稳定状态码规则拥有重试决策。
    if (status === undefined && error.isRetryable) {
      return { kind: 'transport', code: 'provider_transport_error', retryable: true };
    }
    return {
      kind: 'provider',
      code: status === undefined ? 'provider_api_error' : `provider_http_${status}`,
      retryable: retryableStatus(status),
    };
  }
  if (TypeValidationError.isInstance(error) || InvalidResponseDataError.isInstance(error)) {
    return { kind: 'protocol', code: 'provider_response_schema_invalid', retryable: false };
  }
  if (JSONParseError.isInstance(error)) {
    return { kind: 'protocol', code: 'provider_response_json_invalid', retryable: false };
  }
  if (EmptyResponseBodyError.isInstance(error)) {
    return { kind: 'transport', code: 'provider_empty_response', retryable: true };
  }
  if (UnsupportedFunctionalityError.isInstance(error)) {
    return { kind: 'protocol', code: 'provider_feature_unsupported', retryable: false };
  }
  if (error instanceof TypeError) {
    return { kind: 'transport', code: 'provider_transport_error', retryable: true };
  }
  const structuredProviderError = readStructuredProviderError(error);
  if (structuredProviderError) {
    const hostProjection = providerClassifier?.classify({
      phase,
      kind: 'decoded_stream',
      ...(structuredProviderError.status === undefined
        ? {}
        : { status_code: structuredProviderError.status }),
      ...(structuredProviderError.code === undefined ? {} : { code: structuredProviderError.code }),
      ...(structuredProviderError.type === undefined ? {} : { type: structuredProviderError.type }),
      ...(structuredProviderError.reason === undefined
        ? {}
        : { reason: structuredProviderError.reason }),
    });
    if (hostProjection !== undefined) {
      return hostProjection;
    }
    return classifyStructuredProviderError(structuredProviderError);
  }
  if (AISDKError.isInstance(error)) {
    return { kind: 'protocol', code: 'provider_sdk_error', retryable: false };
  }
  if (phase === 'request_projection') {
    return { kind: 'protocol', code: 'host_request_projection_error', retryable: false };
  }
  if (phase === 'provider_stream') {
    return { kind: 'transport', code: 'provider_stream_error', retryable: true };
  }
  return { kind: 'protocol', code: 'provider_protocol_error', retryable: false };
}
