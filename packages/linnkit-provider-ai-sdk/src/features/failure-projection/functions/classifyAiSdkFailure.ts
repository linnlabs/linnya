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
import type { AiSdkProviderSignal } from '../definitions/aiSdkFailureObservation';
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

function classifyApiCallResponseDetail(error: APICallError): AiSdkFailureProjection | undefined {
  const detailCategory = readProviderDetail(error.responseBody);
  if (detailCategory === 'request_too_large') {
    return { kind: 'provider', code: 'provider_request_too_large', retryable: false };
  }
  if (detailCategory === 'unsupported') {
    return { kind: 'protocol', code: 'provider_feature_unsupported', retryable: false };
  }
  return undefined;
}

interface StructuredProviderError {
  readonly status?: number;
  readonly code?: string;
  readonly type?: string;
  readonly reason?: string;
  /** Provider stream 的安全类别；只在本函数内参与稳定 code 投影。 */
  readonly detail_category?: ProviderErrorDetailCategory;
  readonly retryable?: boolean;
}

type ProviderErrorDetailCategory =
  | 'quota'
  | 'rate_limit'
  | 'overload'
  | 'timeout'
  | 'authentication'
  | 'permission'
  | 'not_found'
  | 'request_too_large'
  | 'unsupported'
  | 'invalid_request';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value.toLowerCase() : undefined;
}

function readOptionalBoolean(
  record: Record<string, unknown>,
  ...keys: readonly string[]
): boolean | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') return value;
  }
  return undefined;
}

function readHttpStatus(value: unknown): number | undefined {
  const status = typeof value === 'string' && /^\d{3}$/u.test(value) ? Number(value) : value;
  return typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599
    ? status
    : undefined;
}

function classifyProviderDetail(detail: string): ProviderErrorDetailCategory | undefined {
  if (/(insufficient[_ -]?quota|quota|usage limit)/u.test(detail)) return 'quota';
  if (/(rate[_ -]?limit|too[_ -]?many[_ -]?requests|rate limit)/u.test(detail)) {
    return 'rate_limit';
  }
  if (/(overload|server[_ -]?error|service[_ -]?unavailable|upstream[_ -]?error)/u.test(detail)) {
    return 'overload';
  }
  if (/(timeout|timed[_ -]?out|deadline exceeded)/u.test(detail)) return 'timeout';
  if (/(authentication|unauthorized|invalid api key)/u.test(detail)) return 'authentication';
  if (/(permission|forbidden|access denied)/u.test(detail)) return 'permission';
  if (/(not[_ -]?found|does not exist|unknown model)/u.test(detail)) return 'not_found';
  if (
    /(context[_ -]?length|context window|request[_ -]?too[_ -]?large|payload[_ -]?too[_ -]?large|too large|token limit|maximum.*token)/u.test(
      detail,
    )
  ) {
    return 'request_too_large';
  }
  if (/(unsupported|not supported|not implemented)/u.test(detail)) return 'unsupported';
  if (/(invalid|bad[_ -]?request|malformed|unrecognized)/u.test(detail)) {
    return 'invalid_request';
  }
  return undefined;
}

function readProviderDetail(value: unknown): ProviderErrorDetailCategory | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  // 只在当前调用栈内转换为类别；原始 Provider 文本不会进入返回对象、日志或事件。
  return classifyProviderDetail(value.toLowerCase());
}

function hasStructuredProviderSignal(error: StructuredProviderError): boolean {
  return (
    error.status !== undefined ||
    error.code !== undefined ||
    error.type !== undefined ||
    error.reason !== undefined ||
    error.detail_category !== undefined ||
    error.retryable !== undefined
  );
}

function mergeStructuredProviderErrors(
  outer: StructuredProviderError,
  nested: StructuredProviderError | undefined,
): StructuredProviderError | undefined {
  const merged: StructuredProviderError = {
    ...(outer.status === undefined ? {} : { status: outer.status }),
    ...(outer.code === undefined ? {} : { code: outer.code }),
    ...(outer.type === undefined ? {} : { type: outer.type }),
    ...(outer.reason === undefined ? {} : { reason: outer.reason }),
    ...(outer.detail_category === undefined ? {} : { detail_category: outer.detail_category }),
    ...(outer.retryable === undefined ? {} : { retryable: outer.retryable }),
    ...(nested?.status !== undefined && outer.status === undefined ? { status: nested.status } : {}),
    ...(nested?.code !== undefined && outer.code === undefined ? { code: nested.code } : {}),
    ...(nested?.type !== undefined && outer.type === undefined ? { type: nested.type } : {}),
    ...(nested?.reason !== undefined && outer.reason === undefined ? { reason: nested.reason } : {}),
    ...(nested?.detail_category !== undefined && outer.detail_category === undefined
      ? { detail_category: nested.detail_category }
      : {}),
    ...(nested?.retryable !== undefined && outer.retryable === undefined
      ? { retryable: nested.retryable }
      : {}),
  };
  return hasStructuredProviderSignal(merged) ? merged : undefined;
}

/**
 * OpenAI-compatible 等 SDK 的流式 error chunk 会直接暴露已经解析后的普通对象，
 * Ollama 原生客户端则会把 NDJSON 的 `{ error }` 包成 OllamaError。这里只读取
 * 无敏感语义的判别字段，Provider message 只在当前调用栈内转换为类别。
 */
function readStructuredProviderError(
  error: unknown,
  depth = 0,
): StructuredProviderError | undefined {
  if (depth > 3) return undefined;

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
    const nested = error.data === undefined ? undefined : readStructuredProviderError(error.data, depth + 1);
    return mergeStructuredProviderErrors(
      {
        ...(error.statusCode === undefined ? {} : { status: error.statusCode }),
        ...(code === undefined ? {} : { code }),
        ...(type === undefined ? {} : { type }),
        retryable: error.isRetryable,
      },
      nested,
    );
  }

  if (error instanceof Error) {
    const causeValue = Reflect.get(error, 'cause');
    const cause = causeValue === undefined ? undefined : readStructuredProviderError(causeValue, depth + 1);
    const data = Reflect.get(error, 'data');
    const nestedData = data === undefined ? undefined : readStructuredProviderError(data, depth + 1);
    const nested = mergeStructuredProviderErrors(cause ?? {}, nestedData);
    // ollama-js 会把流中的 NDJSON `{ error }` 转成普通 Error(message)，这里只提取
    // 稳定类别；原始 message 不能进入 canonical failure、诊断日志或用户可见结果。
    const detailCategory = readProviderDetail(error.message);
    const status = readHttpStatus(
      Reflect.get(error, 'status_code') ?? Reflect.get(error, 'statusCode'),
    );
    const codeValue = Reflect.get(error, 'code');
    const code =
      typeof codeValue === 'number'
        ? String(codeValue)
        : typeof codeValue === 'string' && codeValue.length > 0
          ? codeValue.toLowerCase()
          : undefined;
    const typeValue = Reflect.get(error, 'type');
    const type = typeof typeValue === 'string' && typeValue.length > 0
      ? typeValue.toLowerCase()
      : undefined;
    const reasonValue = Reflect.get(error, 'reason');
    const reason = typeof reasonValue === 'string' && reasonValue.length > 0
      ? reasonValue.toLowerCase()
      : undefined;
    // ai-sdk-ollama 用普通 Error 包装原生客户端的 `{ error }`，该包装没有 status/code。
    return mergeStructuredProviderErrors(
      {
        ...(status === undefined ? {} : { status }),
        ...(code === undefined ? {} : { code }),
        ...(type === undefined ? {} : { type }),
        ...(reason === undefined ? {} : { reason }),
        ...(detailCategory === undefined ? {} : { detail_category: detailCategory }),
        ...(error.name === 'OllamaError' ? { retryable: true } : {}),
      },
      nested,
    );
  }

  if (!isRecord(error)) return undefined;
  const record = error;
  const status = readHttpStatus(record.status ?? record.status_code);
  const code = readOptionalString(record, 'code');
  const type = readOptionalString(record, 'type');
  const reason = readOptionalString(record, 'reason');
  const retryable = readOptionalBoolean(record, 'isRetryable', 'is_retryable', 'retryable');
  const nested = record.error === undefined
    ? undefined
    : readStructuredProviderError(record.error, depth + 1);
  const detailCategory = readProviderDetail(record.error);

  // @ai-sdk/openai 在 Responses 流已经产生输出后，会把 response.failed 作为嵌套普通对象交给 Core。
  const response = isRecord(record.response) ? record.response : undefined;
  const responseError = isRecord(response?.error) ? response.error : undefined;
  const incompleteDetails = isRecord(response?.incomplete_details)
    ? response.incomplete_details
    : undefined;
  const responseFailure = type === 'response.failed'
    ? {
        ...(readHttpStatus(responseError?.code) === undefined
          ? {}
          : { status: readHttpStatus(responseError?.code) }),
        ...(responseError === undefined
          ? {}
          : (() => {
              const responseCode = readOptionalString(responseError, 'code');
              return responseCode === undefined ? {} : { code: responseCode };
            })()),
        ...(incompleteDetails === undefined
          ? {}
          : { reason: readOptionalString(incompleteDetails, 'reason') }),
      }
    : {};

  return mergeStructuredProviderErrors(
    {
      ...(status === undefined ? {} : { status }),
      ...(code === undefined ? {} : { code }),
      ...(type === undefined ? {} : { type }),
      ...(reason === undefined ? {} : { reason }),
      ...(detailCategory === undefined ? {} : { detail_category: detailCategory }),
      ...(retryable === undefined
        ? record.error !== undefined && typeof record.error === 'string'
          ? { retryable: true }
          : {}
        : { retryable }),
      ...responseFailure,
    },
    nested,
  );
}

function readBoundedDiagnosticString(value: string | undefined): string | undefined {
  return value !== undefined && value.length <= 128 ? value : undefined;
}

/** 从 SDK/Provider 错误中提取可安全记录的判别字段，不读取原始 message。 */
export function projectAiSdkProviderSignal(error: unknown): AiSdkProviderSignal | undefined {
  const structured = readStructuredProviderError(error);
  if (!structured) return undefined;

  const type = readBoundedDiagnosticString(structured.type);
  const code = readBoundedDiagnosticString(structured.code);
  const reason = readBoundedDiagnosticString(structured.reason);
  const signal: AiSdkProviderSignal = {
    ...(structured.status === undefined ? {} : { status_code: structured.status }),
    ...(type === undefined ? {} : { type }),
    ...(code === undefined ? {} : { code }),
    ...(reason === undefined ? {} : { reason }),
  };
  return Object.keys(signal).length === 0 ? undefined : signal;
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
  // Ollama 原生 `{ error }` 在没有可识别类别时只留下“这是流错误且可重试”的信号，
  // 保持未知 async stream rejection 的 transport 语义，不伪造一个 Provider HTTP 错误。
  if (
    error.retryable !== undefined &&
    error.type === undefined &&
    error.code === undefined &&
    error.reason === undefined &&
    error.detail_category === undefined
  ) {
    return { kind: 'transport', code: 'provider_stream_error', retryable: error.retryable };
  }
  switch (error.detail_category) {
    case 'quota':
      return { kind: 'provider', code: 'provider_quota_exhausted', retryable: false };
    case 'rate_limit':
      return { kind: 'provider', code: 'provider_stream_rate_limited', retryable: true };
    case 'overload':
      return { kind: 'provider', code: 'provider_stream_unavailable', retryable: true };
    case 'timeout':
      return { kind: 'provider', code: 'provider_stream_timeout', retryable: true };
    case 'authentication':
      return { kind: 'provider', code: 'provider_http_401', retryable: false };
    case 'permission':
      return { kind: 'provider', code: 'provider_http_403', retryable: false };
    case 'not_found':
      return { kind: 'provider', code: 'provider_http_404', retryable: false };
    case 'request_too_large':
      return { kind: 'provider', code: 'provider_request_too_large', retryable: false };
    case 'unsupported':
      return { kind: 'protocol', code: 'provider_feature_unsupported', retryable: false };
    case 'invalid_request':
      return { kind: 'provider', code: 'provider_http_400', retryable: false };
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
  return { kind: 'provider', code: 'provider_stream_error', retryable: error.retryable ?? false };
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
    const responseDetailFailure = classifyApiCallResponseDetail(error);
    if (responseDetailFailure !== undefined) {
      return responseDetailFailure;
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
