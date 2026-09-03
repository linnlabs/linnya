export class TranscriptionModelUnavailableError extends Error {
  constructor() {
    super('No audio transcription model is available');
    this.name = 'TranscriptionModelUnavailableError';
  }
}

export class TranscriptionServiceUnavailableError extends Error {
  constructor() {
    super('Transcription service is unavailable');
    this.name = 'TranscriptionServiceUnavailableError';
  }
}

export class TranscriptionAudioFileMissingError extends Error {
  constructor() {
    super('Transcription audio file is missing');
    this.name = 'TranscriptionAudioFileMissingError';
  }
}
