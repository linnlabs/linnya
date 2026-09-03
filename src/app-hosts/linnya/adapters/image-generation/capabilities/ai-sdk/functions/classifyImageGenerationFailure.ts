import { APICallError } from 'ai';
import type { ImageGenerationFailureKind } from 'src/domains/image-generation';

export interface ImageGenerationFailureProjection {
  readonly kind: ImageGenerationFailureKind;
  readonly code: string;
  readonly retryable: boolean;
}

function isRetryableStatus(status: number | undefined): boolean {
  return status === 408 || status === 409 || status === 429
    || (status !== undefined && status >= 500);
}

export function classifyImageGenerationFailure(
  error: unknown,
  signal: AbortSignal | undefined,
): ImageGenerationFailureProjection {
  if (signal?.aborted) {
    return { kind: 'aborted', code: 'request_aborted', retryable: false };
  }
  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    return {
      kind: 'provider',
      code: status === undefined ? 'provider_api_error' : `provider_http_${status}`,
      retryable: isRetryableStatus(status),
    };
  }
  if (error instanceof TypeError) {
    return { kind: 'transport', code: 'provider_transport_error', retryable: true };
  }
  return { kind: 'protocol', code: 'provider_protocol_error', retryable: false };
}
