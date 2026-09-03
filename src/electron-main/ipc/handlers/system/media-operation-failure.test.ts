import { describe, expect, it } from 'vitest';
import {
  MediaAudioDataEmptyError,
  MediaFileExtensionNotAllowedError,
  MediaInvalidFilePathError,
  MediaPathNotAllowedError,
  MediaPathNotFileError,
  MediaSourceWindowNotFoundError,
  MediaUnknownMimeTypeError,
} from '../../../../features/system/media/definitions/mediaErrors';
import { createMediaOperationFailure } from './media-operation-failure';

describe('createMediaOperationFailure', () => {
  it('maps predictable media errors to stable user message keys', () => {
    expect(createMediaOperationFailure(
      new MediaInvalidFilePathError('loadImageAsDataUrl'),
      'system.media.image.loadFailed',
    ).userMessage?.key).toBe('system.media.file.invalidPath');

    expect(createMediaOperationFailure(
      new MediaUnknownMimeTypeError('/tmp/image.bin'),
      'system.media.image.loadFailed',
    ).userMessage?.key).toBe('system.media.image.unknownMimeType');

    expect(createMediaOperationFailure(
      new MediaPathNotFileError('/tmp/images'),
      'system.media.generatedImage.loadFailed',
    ).userMessage?.key).toBe('system.media.file.notFile');

    expect(createMediaOperationFailure(
      new MediaPathNotAllowedError('/etc/passwd'),
      'system.media.image.loadFailed',
    ).userMessage?.key).toBe('system.media.file.invalidPath');

    expect(createMediaOperationFailure(
      new MediaFileExtensionNotAllowedError('/tmp/file.txt', 'image'),
      'system.media.image.loadFailed',
    ).userMessage?.key).toBe('system.media.file.invalidPath');

    expect(createMediaOperationFailure(
      new MediaAudioDataEmptyError(),
      'system.media.audio.saveFailed',
    ).userMessage?.key).toBe('system.media.audio.emptyData');

    expect(createMediaOperationFailure(
      new MediaSourceWindowNotFoundError(),
      'system.media.dialog.openFailed',
    ).userMessage?.key).toBe('system.media.dialog.sourceWindowMissing');
  });

  it('keeps raw error text as diagnostic instead of UI message truth', () => {
    const failure = createMediaOperationFailure(
      new Error('ENOENT: no such file or directory'),
      'system.media.file.sizeFailed',
    );

    expect(failure.error).toContain('ENOENT');
    expect(failure.userMessage?.key).toBe('system.media.file.sizeFailed');
    expect(failure.userMessage?.diagnostic).toContain('ENOENT');
  });
});
