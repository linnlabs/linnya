import path from 'node:path';

import type { ShellWorkingDirectoryFileSystemPort } from '../../../ports/shellWorkingDirectoryFileSystemPort';
import {
  ShellWorkingDirectoryError,
  type ShellWorkingDirectoryErrorCode,
  type ShellWorkingDirectoryFailureStage,
  type ShellWorkingDirectoryRequest,
  type ShellWorkingDirectoryResolution,
} from '../definitions/shellWorkingDirectory';
import {
  isNetworkShellWorkingDirectory,
  planShellWorkingDirectoryCandidate,
} from '../functions/planShellWorkingDirectoryCandidate';

function projectFileSystemFailure(input: {
  readonly result: Exclude<
    Awaited<ReturnType<ShellWorkingDirectoryFileSystemPort['resolveDirectory']>>,
    { readonly status: 'resolved' }
  >;
  readonly stage: ShellWorkingDirectoryFailureStage;
}): ShellWorkingDirectoryError {
  const codeByStatus: Readonly<Record<typeof input.result.status, ShellWorkingDirectoryErrorCode>> = {
    not_found: 'cwd_not_found',
    not_directory: 'cwd_not_directory',
    denied: 'cwd_denied',
    failed: 'cwd_resolution_failed',
  };
  return new ShellWorkingDirectoryError(
    codeByStatus[input.result.status],
    input.stage,
    input.result.osCode,
    input.result.operation,
  );
}

async function resolveDirectory(input: {
  readonly absolutePath: string;
  readonly stage: ShellWorkingDirectoryFailureStage;
  readonly fileSystem: ShellWorkingDirectoryFileSystemPort;
}): Promise<string> {
  const result = await input.fileSystem.resolveDirectory(input.absolutePath);
  if (result.status !== 'resolved') {
    throw projectFileSystemFailure({ result, stage: input.stage });
  }
  return result.canonicalPath;
}

function isWithinRoot(input: {
  readonly candidate: string;
  readonly root: string;
  readonly platform: ShellWorkingDirectoryRequest['platform'];
}): boolean {
  const pathApi = input.platform === 'windows' ? path.win32 : path.posix;
  const relative = pathApi.relative(input.root, input.candidate);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${pathApi.sep}`)
    && !pathApi.isAbsolute(relative)
  );
}

export async function resolveShellWorkingDirectory(input: {
  readonly request: ShellWorkingDirectoryRequest;
  readonly fileSystem: ShellWorkingDirectoryFileSystemPort;
}): Promise<ShellWorkingDirectoryResolution> {
  const canonicalConversationRoot = await resolveDirectory({
    absolutePath: input.request.conversationRoot,
    stage: 'resolve_conversation_root',
    fileSystem: input.fileSystem,
  });
  const candidate = planShellWorkingDirectoryCandidate({
    canonicalConversationRoot,
    requestedCwd: input.request.requestedCwd,
    platform: input.request.platform,
    permissionLevel: input.request.permissionLevel,
  });
  const canonicalPath = candidate.source === 'conversation_root'
    ? canonicalConversationRoot
    : await resolveDirectory({
        absolutePath: candidate.absolutePath,
        stage: 'resolve_requested_cwd',
        fileSystem: input.fileSystem,
      });

  if (
    input.request.permissionLevel !== 'full_access'
    && isNetworkShellWorkingDirectory({
      absolutePath: canonicalPath,
      platform: input.request.platform,
    })
  ) {
    throw new ShellWorkingDirectoryError('cwd_denied', 'enforce_permission');
  }

  return Object.freeze({
    canonicalPath,
    canonicalConversationRoot,
    source: candidate.source,
    withinConversationRoot: isWithinRoot({
      candidate: canonicalPath,
      root: canonicalConversationRoot,
      platform: input.request.platform,
    }),
  });
}
