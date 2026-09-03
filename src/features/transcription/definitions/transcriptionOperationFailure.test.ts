import { describe, expect, it } from 'vitest';
import {
  TranscriptionAudioFileMissingError,
  TranscriptionModelUnavailableError,
  TranscriptionServiceUnavailableError,
} from './transcriptionErrors';
import { createTranscriptionOperationFailure } from './transcriptionOperationFailure';

describe('createTranscriptionOperationFailure', () => {
  it('maps predictable transcription errors to stable system message keys', () => {
    expect(createTranscriptionOperationFailure(
      new TranscriptionModelUnavailableError(),
      'system.transcription.failed',
    ).userMessage?.key).toBe('system.transcription.modelUnavailable');

    expect(createTranscriptionOperationFailure(
      new TranscriptionServiceUnavailableError(),
      'system.transcription.failed',
    ).userMessage?.key).toBe('system.transcription.serviceUnavailable');

    expect(createTranscriptionOperationFailure(
      new TranscriptionAudioFileMissingError(),
      'system.transcription.failed',
    ).userMessage?.key).toBe('system.transcription.audioFileMissing');
  });

  it('keeps unexpected error text as diagnostic only', () => {
    const failure = createTranscriptionOperationFailure(
      new Error('transcription provider failed'),
      'system.transcription.failed',
    );

    expect(failure.error).toContain('provider failed');
    expect(failure.userMessage?.key).toBe('system.transcription.failed');
    expect(failure.userMessage?.diagnostic).toContain('provider failed');
  });
});
