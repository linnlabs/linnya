import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

import type { CommandRuntimePlatform } from '../../../packages/schemas/src/commands';
import {
  type ConversationDirectoryCleanupFailure,
  type ConversationDirectoryCleanupJob,
  type ConversationDirectoryCleanupJobBeginResult,
  type ConversationDirectoryCleanupJobPort,
  type ConversationDirectoryCleanupJobScope,
} from '../../../src/domains/conversation-files';
import type {
  ShellWorkingDirectoryErrorCode,
  ShellWorkingDirectoryFailureStage,
  ShellWorkingDirectoryFileSystemPort,
} from '../../../src/domains/commands';
import {
  createConversationLifecycleApplicationScope,
} from '../../../src/app-hosts/linnya/application/conversation-lifecycle';
import {
  withShellWorkingDirectoryAdmission,
} from '../../../src/app-hosts/linnya/adapters/commands/shell-runtime';
import { createNodeShellWorkingDirectoryFileSystemPort } from '../../../src/infra/adapters/command-runtime/working-directory';
import { createLocalConversationDirectoryPort } from '../../../src/infra/adapters/conversation-files/local-directory';

const execFileAsync = promisify(execFile);

class EmptyCleanupJobPort implements ConversationDirectoryCleanupJobPort {
  async begin(job: ConversationDirectoryCleanupJob): Promise<ConversationDirectoryCleanupJobBeginResult> {
    return { status: 'created', job };
  }

  async read(): Promise<null> {
    return null;
  }

  async list(): Promise<readonly ConversationDirectoryCleanupJob[]> {
    return [];
  }

  async recordFailure(
    _input: ConversationDirectoryCleanupJobScope & {
      readonly failure: ConversationDirectoryCleanupFailure;
    },
  ): Promise<null> {
    return null;
  }

  async complete(): Promise<boolean> {
    return true;
  }
}

function resolvePlatform(): CommandRuntimePlatform {
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'win32') return 'windows';
  throw new Error(`Unsupported E2E platform: ${process.platform}`);
}

async function expectWorkingDirectoryError(input: {
  readonly promise: Promise<unknown>;
  readonly code: ShellWorkingDirectoryErrorCode;
  readonly stage: ShellWorkingDirectoryFailureStage;
}): Promise<void> {
  await assert.rejects(input.promise, (error: unknown) => (
    error instanceof Error
    && 'code' in error
    && error.code === input.code
    && 'stage' in error
    && error.stage === input.stage
  ));
}

async function main(): Promise<void> {
  const platform = resolvePlatform();
  const runRoot = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'linnya-shell-working-directory-e2e-中文 path-'),
  );

  try {
    const fileSystem = createNodeShellWorkingDirectoryFileSystemPort();
    const scope = createConversationLifecycleApplicationScope({
      cleanupJobs: new EmptyCleanupJobPort(),
      directories: createLocalConversationDirectoryPort({ storageRoot: runRoot }),
      facts: {
        exists: async () => false,
        ensure: async () => {},
      },
    });
    const conversationId = 'shell-working-directory-e2e';
    const admit = (requestedCwd?: string, permissionLevel: 'standard' | 'full_access' = 'standard') => (
      withShellWorkingDirectoryAdmission({
        request: {
          conversationId,
          ...(requestedCwd === undefined ? {} : { requestedCwd }),
          platform,
          permissionLevel,
        },
        conversationAdmission: scope.workDirectoryAdmission,
        fileSystem,
        admitted: admission => admission,
      })
    );

    const initial = await admit();
    const canonicalRoot = await fsp.realpath(initial.conversationDirectory.absolutePath);
    assert.equal(initial.workingDirectory.canonicalPath, canonicalRoot);
    assert.equal(initial.workingDirectory.source, 'conversation_root');

    const child = path.join(initial.conversationDirectory.absolutePath, '中文 子目录');
    await fsp.mkdir(child);
    const relative = await admit(path.join('中文 子目录', '..', '中文 子目录'));
    assert.equal(relative.workingDirectory.canonicalPath, await fsp.realpath(child));
    assert.equal(relative.workingDirectory.withinConversationRoot, true);
    assert.equal((await admit()).workingDirectory.canonicalPath, canonicalRoot);

    const outside = path.join(runRoot, 'outside directory');
    await fsp.mkdir(outside);
    const absolute = await admit(outside);
    assert.equal(absolute.workingDirectory.canonicalPath, await fsp.realpath(outside));
    assert.equal(absolute.workingDirectory.withinConversationRoot, false);

    const link = path.join(initial.conversationDirectory.absolutePath, 'outside-link');
    await fsp.symlink(outside, link, platform === 'windows' ? 'junction' : 'dir');
    let windowsJunctionOutcome: 'resolved' | 'failed_closed' | undefined;
    if (platform === 'windows') {
      const linkStat = await fsp.lstat(link);
      const linkTarget = await fsp.readlink(link);
      process.stderr.write(`${JSON.stringify({
        junctionProbe: {
          isSymbolicLink: linkStat.isSymbolicLink(),
          linkTarget,
        },
      })}\n`);
      try {
        const linked = await admit('outside-link');
        assert.equal(linked.workingDirectory.canonicalPath, await fsp.realpath(outside));
        assert.equal(linked.workingDirectory.withinConversationRoot, false);
        windowsJunctionOutcome = 'resolved';
      } catch (error: unknown) {
        // Windows 安全策略可能拒绝穿越本进程创建的 junction。此时必须稳定失败，
        // 不能手写路径跟随或回退到对话根后继续执行到错误目录。
        assert(error instanceof Error && 'code' in error && 'stage' in error);
        assert.equal(error.code, 'cwd_resolution_failed');
        assert.equal(error.stage, 'resolve_requested_cwd');
        windowsJunctionOutcome = 'failed_closed';
      }
    } else {
      const linked = await admit('outside-link');
      assert.equal(linked.workingDirectory.canonicalPath, await fsp.realpath(outside));
      assert.equal(linked.workingDirectory.withinConversationRoot, false);
    }

    const ordinaryFile = path.join(initial.conversationDirectory.absolutePath, 'ordinary.txt');
    await fsp.writeFile(ordinaryFile, 'file', 'utf8');
    await expectWorkingDirectoryError({
      promise: admit('missing-directory'),
      code: 'cwd_not_found',
      stage: 'resolve_requested_cwd',
    });
    await expectWorkingDirectoryError({
      promise: admit(ordinaryFile),
      code: 'cwd_not_directory',
      stage: 'resolve_requested_cwd',
    });

    if (platform === 'windows') {
      let fileSystemCalls = 0;
      const countingFileSystem: ShellWorkingDirectoryFileSystemPort = {
        resolveDirectory: (absolutePath) => {
          fileSystemCalls += 1;
          return fileSystem.resolveDirectory(absolutePath);
        },
      };
      const deniedBeforeCandidateIo = (requestedCwd: string) => withShellWorkingDirectoryAdmission({
        request: {
          conversationId,
          requestedCwd,
          platform,
          permissionLevel: 'standard',
        },
        conversationAdmission: scope.workDirectoryAdmission,
        fileSystem: countingFileSystem,
        admitted: admission => admission,
      });
      for (const ambiguous of ['C:', 'C:relative', '\\relative']) {
        fileSystemCalls = 0;
        await expectWorkingDirectoryError({
          promise: deniedBeforeCandidateIo(ambiguous),
          code: 'cwd_denied',
          stage: 'plan_requested_cwd',
        });
        assert.equal(fileSystemCalls, 1);
      }
      for (const remote of [
        '\\\\wsl.localhost\\NoSuchDistro\\tmp',
        '\\\\invalid-host-for-linnya\\share',
      ]) {
        fileSystemCalls = 0;
        await expectWorkingDirectoryError({
          promise: deniedBeforeCandidateIo(remote),
          code: 'cwd_denied',
          stage: 'enforce_permission',
        });
        // 唯一 I/O 是已存在的对话根；远端候选没有进入 realpath/stat。
        assert.equal(fileSystemCalls, 1);
      }

      const username = process.env.USERNAME;
      assert(username, 'Windows USERNAME is required for ACL fixture');
      const denied = path.join(runRoot, 'acl-denied');
      await fsp.mkdir(denied);
      await execFileAsync('icacls.exe', [denied, '/deny', `${username}:(RX)`]);
      try {
        await expectWorkingDirectoryError({
          promise: admit(denied),
          code: 'cwd_denied',
          stage: 'resolve_requested_cwd',
        });
      } finally {
        await execFileAsync('icacls.exe', [denied, '/remove:d', username]);
      }
    } else {
      const denied = path.join(runRoot, 'mode-denied');
      await fsp.mkdir(denied, { mode: 0o700 });
      await fsp.chmod(denied, 0o000);
      try {
        await expectWorkingDirectoryError({
          promise: admit(denied),
          code: 'cwd_denied',
          stage: 'resolve_requested_cwd',
        });
      } finally {
        await fsp.chmod(denied, 0o700);
      }
    }

    process.stdout.write(`${JSON.stringify({
      ok: true,
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      cases: platform === 'windows' ? 12 : 7,
      ...(windowsJunctionOutcome === undefined ? {} : { windowsJunctionOutcome }),
    })}\n`);
  } finally {
    await fsp.rm(runRoot, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  if (error instanceof Error && 'code' in error) {
    process.stderr.write(`${JSON.stringify({
      code: error.code,
      ...('stage' in error ? { stage: error.stage } : {}),
      ...('osCode' in error ? { osCode: error.osCode } : {}),
      ...('fileSystemOperation' in error
        ? { fileSystemOperation: error.fileSystemOperation }
        : {}),
    })}\n`);
  }
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
