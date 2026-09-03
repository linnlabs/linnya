import {
  createOperationFailure,
  createUserFacingMessage,
} from '@app/schemas';
import {
  ExportBatchFileNameInvalidError,
  ExportBatchLimitExceededError,
  ExportDirectoryPathRequiredError,
  ExportDirectoryNotAuthorizedError,
  ExportFilesRequiredError,
  ExportFocusedWindowMissingError,
  ExportInvalidPayloadError,
  ExportSourceWindowMissingError,
} from '../../../../features/system/export/definitions/exportErrors';

export type ExportOperationFallbackKey =
  | 'system.export.dialog.openFileFailed'
  | 'system.export.dialog.openDirectoryFailed'
  | 'system.export.file.saveFailed'
  | 'system.export.pdf.saveFailed'
  | 'system.export.batch.writeFailed';

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

export function createExportOperationFailure(
  error: unknown,
  fallbackKey: ExportOperationFallbackKey,
) {
  if (error instanceof ExportFocusedWindowMissingError) {
    return failure(error, 'system.export.window.focusedMissing');
  }

  if (error instanceof ExportSourceWindowMissingError) {
    return failure(error, 'system.export.window.sourceMissing');
  }

  if (error instanceof ExportInvalidPayloadError) {
    return failure(error, 'system.export.batch.invalidPayload');
  }

  if (error instanceof ExportDirectoryPathRequiredError) {
    return failure(error, 'system.export.batch.directoryRequired');
  }

  if (error instanceof ExportFilesRequiredError) {
    return failure(error, 'system.export.batch.filesRequired');
  }

  if (error instanceof ExportBatchFileNameInvalidError) {
    return failure(error, 'system.export.batch.invalidPayload');
  }

  if (error instanceof ExportBatchLimitExceededError) {
    return failure(error, 'system.export.batch.writeFailed');
  }

  if (error instanceof ExportDirectoryNotAuthorizedError) {
    return failure(error, 'system.export.batch.writeFailed');
  }

  return failure(error, fallbackKey);
}
