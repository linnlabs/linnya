import {
  EmptyOcrContentError,
  OcrTimeoutError,
  PdfLocalConversionError,
  type OcrErrorKind,
} from '../definitions/ocrErrors';
import { TextGenerationFailure } from 'src/domains/model-inference';
import { OcrProviderError } from 'src/domains/document-ocr';

export interface OcrErrorClassification {
  kind: OcrErrorKind;
  retryable: boolean;
  shouldReduceConcurrency: boolean;
  shouldSplitSmaller: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readStatusCode(error: unknown): number | undefined {
  if (error instanceof TextGenerationFailure) {
    if (error.code === 'inference.credential_invalid') return 401;
    const matched = /^provider_http_(\d{3})$/.exec(error.code);
    if (matched) return Number(matched[1]);
  }
  if (error instanceof OcrProviderError && typeof error.statusCode === 'number') {
    return error.statusCode;
  }
  if (!isRecord(error)) return undefined;
  const statusCode = error['statusCode'] ?? error['status'];
  return typeof statusCode === 'number' && Number.isFinite(statusCode) ? statusCode : undefined;
}

function readErrorName(error: unknown): string | undefined {
  if (error instanceof Error) return error.name;
  if (!isRecord(error)) return undefined;
  const name = error['name'];
  return typeof name === 'string' ? name : undefined;
}

function readErrorCode(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined;
  const code = error['code'];
  return typeof code === 'string' ? code : undefined;
}

function readErrorCause(error: unknown): unknown {
  if (!isRecord(error)) return undefined;
  return error['cause'];
}

function readExplicitRetryable(error: unknown): boolean | undefined {
  if (error instanceof TextGenerationFailure || error instanceof OcrProviderError) {
    return error.retryable;
  }
  if (!isRecord(error)) return undefined;
  const retryable = error['retryable'];
  return typeof retryable === 'boolean' ? retryable : undefined;
}

function resolveRetryable(defaultValue: boolean, explicitRetryable: boolean | undefined): boolean {
  return explicitRetryable ?? defaultValue;
}

function isAbortLikeError(error: unknown): boolean {
  const name = readErrorName(error);
  if (name === 'AbortError' || name === 'TimeoutError') return true;
  if (error instanceof OcrTimeoutError) return true;
  const code = readErrorCode(error);
  return code === 'ABORT_ERR' || code === 'ETIMEDOUT';
}

function isNetworkLikeError(error: unknown): boolean {
  const code = readErrorCode(error);
  if (!code) return false;
  return ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNABORTED'].includes(code);
}

export function classifyOcrError(error: unknown): OcrErrorClassification {
  const explicitRetryable = readExplicitRetryable(error);

  if (error instanceof EmptyOcrContentError) {
    return {
      kind: 'empty_content',
      retryable: true,
      shouldReduceConcurrency: false,
      shouldSplitSmaller: false,
    };
  }

  if (error instanceof PdfLocalConversionError) {
    return {
      kind: 'local_conversion',
      retryable: false,
      shouldReduceConcurrency: false,
      shouldSplitSmaller: false,
    };
  }

  if (isAbortLikeError(error)) {
    return {
      kind: 'timeout',
      retryable: true,
      shouldReduceConcurrency: true,
      shouldSplitSmaller: true,
    };
  }

  const statusCode = readStatusCode(error);
  if (typeof statusCode === 'number') {
    if (statusCode === 401 || statusCode === 403) {
      return {
        kind: 'auth',
        retryable: resolveRetryable(false, explicitRetryable),
        shouldReduceConcurrency: false,
        shouldSplitSmaller: false,
      };
    }

    if (statusCode === 429) {
      return {
        kind: 'rate_limited',
        retryable: resolveRetryable(true, explicitRetryable),
        shouldReduceConcurrency: true,
        shouldSplitSmaller: false,
      };
    }

    if (statusCode === 413) {
      return {
        kind: 'payload_too_large',
        retryable: resolveRetryable(true, explicitRetryable),
        shouldReduceConcurrency: false,
        shouldSplitSmaller: true,
      };
    }

    if (statusCode >= 400 && statusCode < 500) {
      return {
        kind: 'bad_request',
        retryable: resolveRetryable(false, explicitRetryable),
        shouldReduceConcurrency: false,
        shouldSplitSmaller: false,
      };
    }

    if (statusCode >= 500 && statusCode < 600) {
      return {
        kind: 'server',
        retryable: resolveRetryable(true, explicitRetryable),
        shouldReduceConcurrency: false,
        shouldSplitSmaller: false,
      };
    }
  }

  if (explicitRetryable === false) {
    return {
      kind: 'bad_request',
      retryable: false,
      shouldReduceConcurrency: false,
      shouldSplitSmaller: false,
    };
  }

  const cause = readErrorCause(error);
  if (cause !== undefined) {
    const causeClassification = classifyOcrError(cause);
    if (causeClassification.kind !== 'unknown') {
      return causeClassification;
    }
  }

  if (isNetworkLikeError(error)) {
    return {
      kind: 'network',
      retryable: true,
      shouldReduceConcurrency: false,
      shouldSplitSmaller: false,
    };
  }

  return {
    kind: 'unknown',
    retryable: true,
    shouldReduceConcurrency: false,
    shouldSplitSmaller: false,
  };
}
