export class MediaInvalidFilePathError extends Error {
  constructor(readonly operation: string) {
    super(`Media file path is invalid: ${operation}`);
    this.name = 'MediaInvalidFilePathError';
  }
}

export class MediaUnknownMimeTypeError extends Error {
  constructor(readonly filePath: string) {
    super(`Media MIME type cannot be resolved: ${filePath}`);
    this.name = 'MediaUnknownMimeTypeError';
  }
}

export class MediaPathNotFileError extends Error {
  constructor(readonly filePath: string) {
    super(`Media path is not a file: ${filePath}`);
    this.name = 'MediaPathNotFileError';
  }
}

export class MediaPathNotAllowedError extends Error {
  constructor(readonly filePath: string) {
    super(`Media path is not allowed: ${filePath}`);
    this.name = 'MediaPathNotAllowedError';
  }
}

export class MediaFileExtensionNotAllowedError extends Error {
  constructor(
    readonly filePath: string,
    readonly operation: string,
  ) {
    super(`Media file extension is not allowed for ${operation}: ${filePath}`);
    this.name = 'MediaFileExtensionNotAllowedError';
  }
}

export class MediaAudioDataEmptyError extends Error {
  constructor() {
    super('Media audio data is empty');
    this.name = 'MediaAudioDataEmptyError';
  }
}

export class MediaSourceWindowNotFoundError extends Error {
  constructor() {
    super('Media source window was not found');
    this.name = 'MediaSourceWindowNotFoundError';
  }
}
