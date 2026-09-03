import { createErrorEvent, toSerializableJsonValue, type ErrorEvent } from '../contracts';
import { ENGINE_ERROR_CODES } from './errorClassifier';

type EngineErrorCode = typeof ENGINE_ERROR_CODES[keyof typeof ENGINE_ERROR_CODES];

export function createEngineErrorEvent(params: {
  id: string;
  conversationId: string;
  turnId: string;
  errorCode: EngineErrorCode;
  error: string;
  details?: unknown;
  retryable?: boolean;
}): ErrorEvent {
  return createErrorEvent(
    params.id,
    params.conversationId,
    params.turnId,
    params.error,
    {
      error_code: params.errorCode,
      retryable: params.retryable ?? false,
      ...(params.details === undefined ? {} : { details: toSerializableJsonValue(params.details) }),
    },
  );
}
