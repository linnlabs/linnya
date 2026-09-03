import { constants, promises as fsp } from 'node:fs';

import type {
  ShellWorkingDirectoryFileSystemPort,
  ShellWorkingDirectoryFileSystemOperation,
  ShellWorkingDirectoryFileSystemResult,
} from '../../../../domains/commands';

function readNodeErrorCode(error: unknown): string | undefined {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

function projectNodeFileSystemError(
  error: unknown,
  operation: ShellWorkingDirectoryFileSystemOperation,
): ShellWorkingDirectoryFileSystemResult {
  const osCode = readNodeErrorCode(error);
  if (osCode === 'ENOENT') {
    return { status: 'not_found', osCode, operation };
  }
  if (osCode === 'ENOTDIR') {
    return { status: 'not_directory', osCode, operation };
  }
  if (osCode === 'EACCES' || osCode === 'EPERM') {
    return { status: 'denied', osCode, operation };
  }
  return {
    status: 'failed',
    operation,
    ...(osCode === undefined ? {} : { osCode }),
  };
}

export function createNodeShellWorkingDirectoryFileSystemPort(): ShellWorkingDirectoryFileSystemPort {
  return Object.freeze({
    resolveDirectory: async (
      absolutePath: string,
    ): Promise<ShellWorkingDirectoryFileSystemResult> => {
      let canonicalPath: string;
      try {
        canonicalPath = await fsp.realpath(absolutePath);
      } catch (error: unknown) {
        return projectNodeFileSystemError(error, 'realpath');
      }
      let stat;
      try {
        stat = await fsp.stat(canonicalPath);
      } catch (error: unknown) {
        return projectNodeFileSystemError(error, 'stat');
      }
      if (!stat.isDirectory()) {
        return { status: 'not_directory', operation: 'stat' };
      }
      try {
        await fsp.access(canonicalPath, constants.R_OK | constants.X_OK);
      } catch (error: unknown) {
        return projectNodeFileSystemError(error, 'access');
      }
      return { status: 'resolved', canonicalPath };
    },
  });
}
