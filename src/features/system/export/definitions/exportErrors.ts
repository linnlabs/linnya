export class ExportFocusedWindowMissingError extends Error {
  constructor(readonly operation: string) {
    super(`Export focused window is missing: ${operation}`);
    this.name = 'ExportFocusedWindowMissingError';
  }
}

export class ExportSourceWindowMissingError extends Error {
  constructor(readonly operation: string) {
    super(`Export source window is missing: ${operation}`);
    this.name = 'ExportSourceWindowMissingError';
  }
}

export class ExportInvalidPayloadError extends Error {
  constructor(readonly operation: string) {
    super(`Export payload is invalid: ${operation}`);
    this.name = 'ExportInvalidPayloadError';
  }
}

export class ExportDirectoryPathRequiredError extends Error {
  constructor() {
    super('Export directory path is required');
    this.name = 'ExportDirectoryPathRequiredError';
  }
}

export class ExportFilesRequiredError extends Error {
  constructor() {
    super('Export files must be an array');
    this.name = 'ExportFilesRequiredError';
  }
}

export class ExportBatchFileNameInvalidError extends Error {
  constructor(
    readonly fileName: string,
    readonly reason: string,
  ) {
    super(`Export batch file name is invalid: ${reason}`);
    this.name = 'ExportBatchFileNameInvalidError';
  }
}

export class ExportBatchLimitExceededError extends Error {
  constructor(
    readonly limitName: string,
    readonly limit: number,
  ) {
    super(`Export batch limit exceeded: ${limitName} <= ${limit}`);
    this.name = 'ExportBatchLimitExceededError';
  }
}

export class ExportDirectoryNotAuthorizedError extends Error {
  constructor(readonly directoryPath: string) {
    super('Export directory was not selected in this session');
    this.name = 'ExportDirectoryNotAuthorizedError';
  }
}

export class ExportArtifactRequestInvalidError extends Error {
  constructor(readonly field: string) {
    super(`Export artifact request is invalid: ${field}`);
    this.name = 'ExportArtifactRequestInvalidError';
  }
}

export class ExportArtifactTargetMissingError extends Error {
  constructor() {
    super('Export artifact target is missing or already consumed');
    this.name = 'ExportArtifactTargetMissingError';
  }
}

export class ExportArtifactTargetExpiredError extends Error {
  constructor() {
    super('Export artifact target has expired');
    this.name = 'ExportArtifactTargetExpiredError';
  }
}

export class ExportArtifactTargetOwnerMismatchError extends Error {
  constructor() {
    super('Export artifact target belongs to another plugin');
    this.name = 'ExportArtifactTargetOwnerMismatchError';
  }
}

export class ExportArtifactTargetDescriptorMismatchError extends Error {
  constructor() {
    super('Export artifact target does not match the committed artifact');
    this.name = 'ExportArtifactTargetDescriptorMismatchError';
  }
}
