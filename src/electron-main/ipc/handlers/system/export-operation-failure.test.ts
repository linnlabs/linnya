import { describe, expect, it } from 'vitest';
import {
  ExportDirectoryPathRequiredError,
  ExportFilesRequiredError,
  ExportFocusedWindowMissingError,
  ExportInvalidPayloadError,
  ExportSourceWindowMissingError,
} from '../../../../features/system/export/definitions/exportErrors';
import { createExportOperationFailure } from './export-operation-failure';

describe('createExportOperationFailure', () => {
  it('maps predictable export errors to stable user message keys', () => {
    expect(createExportOperationFailure(
      new ExportFocusedWindowMissingError('export-file'),
      'system.export.file.saveFailed',
    ).userMessage?.key).toBe('system.export.window.focusedMissing');

    expect(createExportOperationFailure(
      new ExportSourceWindowMissingError('export-pdf'),
      'system.export.pdf.saveFailed',
    ).userMessage?.key).toBe('system.export.window.sourceMissing');

    expect(createExportOperationFailure(
      new ExportInvalidPayloadError('export-files-to-directory'),
      'system.export.batch.writeFailed',
    ).userMessage?.key).toBe('system.export.batch.invalidPayload');

    expect(createExportOperationFailure(
      new ExportDirectoryPathRequiredError(),
      'system.export.batch.writeFailed',
    ).userMessage?.key).toBe('system.export.batch.directoryRequired');

    expect(createExportOperationFailure(
      new ExportFilesRequiredError(),
      'system.export.batch.writeFailed',
    ).userMessage?.key).toBe('system.export.batch.filesRequired');
  });

  it('keeps unexpected error text as diagnostic only', () => {
    const failure = createExportOperationFailure(
      new Error('EACCES: permission denied'),
      'system.export.file.saveFailed',
    );

    expect(failure.error).toContain('EACCES');
    expect(failure.userMessage?.key).toBe('system.export.file.saveFailed');
    expect(failure.userMessage?.diagnostic).toContain('EACCES');
  });
});
