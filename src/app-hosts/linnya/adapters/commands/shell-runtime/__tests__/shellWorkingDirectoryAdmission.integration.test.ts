import Database from 'better-sqlite3';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ShellWorkingDirectoryFileSystemPort } from '../../../../../../domains/commands';
import { createLocalConversationDirectoryPort } from '../../../../../../infra/adapters/conversation-files/local-directory';
import { createNodeShellWorkingDirectoryFileSystemPort } from '../../../../../../infra/adapters/command-runtime/working-directory';
import {
  CONVERSATION_DIRECTORY_CLEANUP_JOB_SCHEMA,
  SqliteConversationDirectoryCleanupJobPort,
} from '../../../persistence/conversation-files';
import {
  createConversationLifecycleApplicationScope,
  type ConversationLifecycleApplicationScope,
} from '../../../../application/conversation-lifecycle';
import { withShellWorkingDirectoryAdmission } from '../orchestration/withShellWorkingDirectoryAdmission';

const testRoots: string[] = [];
const testDatabases: Database.Database[] = [];

async function createFixture(label: string): Promise<{
  readonly root: string;
  readonly scope: ConversationLifecycleApplicationScope;
  readonly fileSystem: ShellWorkingDirectoryFileSystemPort;
}> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), `linnya-shell-cwd-${label}-中文 path-`));
  testRoots.push(root);
  const db = new Database(path.join(root, 'workspace.sqlite'));
  testDatabases.push(db);
  for (const ddl of CONVERSATION_DIRECTORY_CLEANUP_JOB_SCHEMA) {
    db.exec(ddl);
  }
  const cleanupJobs = new SqliteConversationDirectoryCleanupJobPort(db);
  return {
    root,
    scope: createConversationLifecycleApplicationScope({
      cleanupJobs,
      directories: createLocalConversationDirectoryPort({ storageRoot: root }),
      facts: {
        exists: async () => false,
        ensure: async () => {},
      },
    }),
    fileSystem: createNodeShellWorkingDirectoryFileSystemPort(),
  };
}

afterEach(async () => {
  for (const db of testDatabases.splice(0)) {
    if (db.open) db.close();
  }
  await Promise.all(testRoots.splice(0).map(root => fsp.rm(root, {
    recursive: true,
    force: true,
  })));
});

describe('shell working directory admission', () => {
  it('每次默认回到 canonical 对话根，相对 cwd 只影响当前调用', async () => {
    const fixture = await createFixture('relative');
    const conversationId = 'shell-cwd-relative';
    const first = await withShellWorkingDirectoryAdmission({
      request: {
        conversationId,
        platform: 'macos',
        permissionLevel: 'standard',
      },
      conversationAdmission: fixture.scope.workDirectoryAdmission,
      fileSystem: fixture.fileSystem,
      admitted: admission => admission,
    });
    const canonicalRoot = await fsp.realpath(first.conversationDirectory.absolutePath);
    expect(first.workingDirectory).toEqual({
      canonicalPath: canonicalRoot,
      canonicalConversationRoot: canonicalRoot,
      source: 'conversation_root',
      withinConversationRoot: true,
    });

    const child = path.join(first.conversationDirectory.absolutePath, '中文 子目录');
    await fsp.mkdir(child);
    const explicit = await withShellWorkingDirectoryAdmission({
      request: {
        conversationId,
        requestedCwd: '中文 子目录/../中文 子目录',
        platform: 'macos',
        permissionLevel: 'standard',
      },
      conversationAdmission: fixture.scope.workDirectoryAdmission,
      fileSystem: fixture.fileSystem,
      admitted: admission => admission,
    });
    expect(explicit.workingDirectory).toEqual({
      canonicalPath: await fsp.realpath(child),
      canonicalConversationRoot: canonicalRoot,
      source: 'explicit',
      withinConversationRoot: true,
    });

    const nextDefault = await withShellWorkingDirectoryAdmission({
      request: {
        conversationId,
        platform: 'macos',
        permissionLevel: 'standard',
      },
      conversationAdmission: fixture.scope.workDirectoryAdmission,
      fileSystem: fixture.fileSystem,
      admitted: admission => admission.workingDirectory,
    });
    expect(nextDefault.canonicalPath).toBe(canonicalRoot);
    expect(nextDefault.source).toBe('conversation_root');
  });

  it('显式绝对目录和目录链接都冻结为真实 canonical 路径', async () => {
    const fixture = await createFixture('canonical');
    const conversationId = 'shell-cwd-canonical';
    const initial = await withShellWorkingDirectoryAdmission({
      request: { conversationId, platform: 'macos', permissionLevel: 'standard' },
      conversationAdmission: fixture.scope.workDirectoryAdmission,
      fileSystem: fixture.fileSystem,
      admitted: admission => admission,
    });
    const outside = path.join(fixture.root, 'outside working directory');
    await fsp.mkdir(outside);
    const linked = path.join(initial.conversationDirectory.absolutePath, 'linked-outside');
    await fsp.symlink(outside, linked, 'dir');

    const throughLink = await withShellWorkingDirectoryAdmission({
      request: {
        conversationId,
        requestedCwd: 'linked-outside',
        platform: 'macos',
        permissionLevel: 'standard',
      },
      conversationAdmission: fixture.scope.workDirectoryAdmission,
      fileSystem: fixture.fileSystem,
      admitted: admission => admission.workingDirectory,
    });
    expect(throughLink.canonicalPath).toBe(await fsp.realpath(outside));
    expect(throughLink.withinConversationRoot).toBe(false);

    const absolute = await withShellWorkingDirectoryAdmission({
      request: {
        conversationId,
        requestedCwd: outside,
        platform: 'macos',
        permissionLevel: 'read_only',
      },
      conversationAdmission: fixture.scope.workDirectoryAdmission,
      fileSystem: fixture.fileSystem,
      admitted: admission => admission.workingDirectory,
    });
    expect(absolute.canonicalPath).toBe(await fsp.realpath(outside));
    expect(absolute.withinConversationRoot).toBe(false);
  });

  it('缺失路径和普通文件明确失败，不执行 callback 或回退对话根', async () => {
    const fixture = await createFixture('failures');
    const conversationId = 'shell-cwd-failures';
    const rootAdmission = await withShellWorkingDirectoryAdmission({
      request: { conversationId, platform: 'macos', permissionLevel: 'standard' },
      conversationAdmission: fixture.scope.workDirectoryAdmission,
      fileSystem: fixture.fileSystem,
      admitted: admission => admission,
    });
    const ordinaryFile = path.join(rootAdmission.conversationDirectory.absolutePath, 'file.txt');
    await fsp.writeFile(ordinaryFile, 'not a directory', 'utf8');
    let callbackCount = 0;

    await expect(withShellWorkingDirectoryAdmission({
      request: {
        conversationId,
        requestedCwd: 'missing',
        platform: 'macos',
        permissionLevel: 'standard',
      },
      conversationAdmission: fixture.scope.workDirectoryAdmission,
      fileSystem: fixture.fileSystem,
      admitted: () => {
        callbackCount += 1;
      },
    })).rejects.toMatchObject({
      code: 'cwd_not_found',
      stage: 'resolve_requested_cwd',
    });
    await expect(withShellWorkingDirectoryAdmission({
      request: {
        conversationId,
        requestedCwd: ordinaryFile,
        platform: 'macos',
        permissionLevel: 'standard',
      },
      conversationAdmission: fixture.scope.workDirectoryAdmission,
      fileSystem: fixture.fileSystem,
      admitted: () => {
        callbackCount += 1;
      },
    })).rejects.toMatchObject({
      code: 'cwd_not_directory',
      stage: 'resolve_requested_cwd',
    });
    expect(callbackCount).toBe(0);
  });

  it('当前用户不能读取或进入的目录返回 cwd_denied', async () => {
    const fixture = await createFixture('denied');
    const denied = path.join(fixture.root, 'denied');
    await fsp.mkdir(denied, { mode: 0o700 });
    await fsp.chmod(denied, 0o000);
    try {
      await expect(withShellWorkingDirectoryAdmission({
        request: {
          conversationId: 'shell-cwd-denied',
          requestedCwd: denied,
          platform: 'macos',
          permissionLevel: 'standard',
        },
        conversationAdmission: fixture.scope.workDirectoryAdmission,
        fileSystem: fixture.fileSystem,
        admitted: admission => admission,
      })).rejects.toMatchObject({
        code: 'cwd_denied',
        stage: 'resolve_requested_cwd',
      });
    } finally {
      await fsp.chmod(denied, 0o700);
    }
  });
});
