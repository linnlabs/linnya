import {
  createOperationFailure,
  createUserFacingMessage,
} from '@app/schemas';
import {
  ShellExternalUrlInvalidError,
  ShellExternalUrlRequiredError,
  ShellExternalUrlUnsupportedProtocolError,
  ShellItemPathRequiredError,
} from '../../../../features/system/shell/definitions/shellErrors';

export type ShellOperationFallbackKey =
  | 'system.shell.external.openFailed'
  | 'system.shell.item.showInFolderFailed';

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

export function createShellOperationFailure(
  error: unknown,
  fallbackKey: ShellOperationFallbackKey,
) {
  if (error instanceof ShellExternalUrlRequiredError) {
    return failure(error, 'system.shell.external.urlRequired');
  }

  if (error instanceof ShellExternalUrlInvalidError) {
    return failure(error, 'system.shell.external.urlInvalid');
  }

  if (error instanceof ShellExternalUrlUnsupportedProtocolError) {
    return failure(error, 'system.shell.external.unsupportedProtocol');
  }

  if (error instanceof ShellItemPathRequiredError) {
    return failure(error, 'system.shell.item.pathRequired');
  }

  return failure(error, fallbackKey);
}
