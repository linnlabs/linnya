import {
  createOperationFailure,
  createUserFacingMessage,
} from '@app/schemas';
import {
  TranscriptionAudioFileMissingError,
  TranscriptionModelUnavailableError,
  TranscriptionServiceUnavailableError,
} from './transcriptionErrors';

export type TranscriptionOperationFallbackKey = 'system.transcription.failed';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failure(error: unknown, key: string) {
  const diagnostic = getErrorMessage(error);
  return createOperationFailure(
    diagnostic,
    createUserFacingMessage(key, { diagnostic }),
  );
}

export function createTranscriptionOperationFailure(
  error: unknown,
  fallbackKey: TranscriptionOperationFallbackKey,
) {
  if (error instanceof TranscriptionModelUnavailableError) {
    return failure(error, 'system.transcription.modelUnavailable');
  }

  if (error instanceof TranscriptionServiceUnavailableError) {
    return failure(error, 'system.transcription.serviceUnavailable');
  }

  if (error instanceof TranscriptionAudioFileMissingError) {
    return failure(error, 'system.transcription.audioFileMissing');
  }

  return failure(error, fallbackKey);
}
