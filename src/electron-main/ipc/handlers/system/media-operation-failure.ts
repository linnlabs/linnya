import {
  createOperationFailure,
  createUserFacingMessage,
  type OperationFailure,
} from '@app/schemas';
import {
  MediaAudioDataEmptyError,
  MediaFileExtensionNotAllowedError,
  MediaInvalidFilePathError,
  MediaPathNotAllowedError,
  MediaPathNotFileError,
  MediaSourceWindowNotFoundError,
  MediaUnknownMimeTypeError,
} from '../../../../features/system/media/definitions/mediaErrors';

export type MediaOperationFallbackKey =
  | 'system.media.dialog.openFailed'
  | 'system.media.image.loadFailed'
  | 'system.media.image.embedFailed'
  | 'system.media.generatedImage.loadFailed'
  | 'system.media.image.statFailed'
  | 'system.media.audio.saveFailed'
  | 'system.media.audio.loadFailed'
  | 'system.media.file.sizeFailed';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failure(error: unknown, key: string): OperationFailure {
  const diagnostic = getErrorMessage(error);
  return createOperationFailure(
    diagnostic,
    createUserFacingMessage(key, { diagnostic }),
  );
}

export function createMediaOperationFailure(
  error: unknown,
  fallbackKey: MediaOperationFallbackKey,
): OperationFailure {
  if (error instanceof MediaInvalidFilePathError) {
    return failure(error, 'system.media.file.invalidPath');
  }

  if (error instanceof MediaUnknownMimeTypeError) {
    return failure(error, 'system.media.image.unknownMimeType');
  }

  if (error instanceof MediaPathNotFileError) {
    return failure(error, 'system.media.file.notFile');
  }

  if (error instanceof MediaPathNotAllowedError) {
    return failure(error, 'system.media.file.invalidPath');
  }

  if (error instanceof MediaFileExtensionNotAllowedError) {
    return failure(error, 'system.media.file.invalidPath');
  }

  if (error instanceof MediaAudioDataEmptyError) {
    return failure(error, 'system.media.audio.emptyData');
  }

  if (error instanceof MediaSourceWindowNotFoundError) {
    return failure(error, 'system.media.dialog.sourceWindowMissing');
  }

  return failure(error, fallbackKey);
}
