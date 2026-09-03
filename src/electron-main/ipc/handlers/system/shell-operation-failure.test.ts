import { describe, expect, it } from 'vitest';
import {
  ShellExternalUrlInvalidError,
  ShellExternalUrlRequiredError,
  ShellExternalUrlUnsupportedProtocolError,
  ShellItemPathRequiredError,
} from '../../../../features/system/shell/definitions/shellErrors';
import { createShellOperationFailure } from './shell-operation-failure';

describe('createShellOperationFailure', () => {
  it('maps predictable shell errors to stable system message keys', () => {
    expect(createShellOperationFailure(
      new ShellExternalUrlRequiredError(),
      'system.shell.external.openFailed',
    ).userMessage?.key).toBe('system.shell.external.urlRequired');

    expect(createShellOperationFailure(
      new ShellExternalUrlInvalidError('not a url'),
      'system.shell.external.openFailed',
    ).userMessage?.key).toBe('system.shell.external.urlInvalid');

    expect(createShellOperationFailure(
      new ShellExternalUrlUnsupportedProtocolError('file:'),
      'system.shell.external.openFailed',
    ).userMessage?.key).toBe('system.shell.external.unsupportedProtocol');

    expect(createShellOperationFailure(
      new ShellItemPathRequiredError(),
      'system.shell.item.showInFolderFailed',
    ).userMessage?.key).toBe('system.shell.item.pathRequired');
  });

  it('keeps unexpected error text as diagnostic only', () => {
    const failure = createShellOperationFailure(
      new Error('shell failed'),
      'system.shell.external.openFailed',
    );

    expect(failure.error).toContain('shell failed');
    expect(failure.userMessage?.key).toBe('system.shell.external.openFailed');
    expect(failure.userMessage?.diagnostic).toContain('shell failed');
  });
});
