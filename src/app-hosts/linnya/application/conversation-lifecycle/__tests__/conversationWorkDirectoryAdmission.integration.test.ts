import Database from 'better-sqlite3';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createConversationDirectoryCleanupJob,
  deriveConversationWorkDirectoryIdentity,
  type ConversationDirectoryPort,
} from '../../../../../domains/conversation-files';
import { createLocalConversationDirectoryPort } from '../../../../../infra/adapters/conversation-files/local-directory';
import {
  CONVERSATION_DIRECTORY_CLEANUP_JOB_SCHEMA,
  SqliteConversationDirectoryCleanupJobPort,
} from '../../../adapters/persistence/conversation-files';
import type { ConversationFactsPort } from '../definitions/conversationFactsPort';
import {
  createConversationLifecycleApplicationScope,
  type ConversationLifecycleApplicationScope,
} from '../orchestration/createConversationLifecycleApplicationScope';

const testRoots: string[] = [];
const testDatabases: Database.Database[] = [];

async function createFixture(label: string): Promise<{
  readonly root: string;
  readonly db: Database.Database;
  readonly cleanupJobs: SqliteConversationDirectoryCleanupJobPort;
  readonly directories: ConversationDirectoryPort;
  readonly facts: ConversationFactsPort;
}> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), `linnya-admission-${label}-`));
  testRoots.push(root);
  const db = new Database(path.join(root, 'workspace.sqlite'));
  testDatabases.push(db);
  for (const ddl of CONVERSATION_DIRECTORY_CLEANUP_JOB_SCHEMA) {
    db.exec(ddl);
  }
  return {
    root,
    db,
    cleanupJobs: new SqliteConversationDirectoryCleanupJobPort(db),
    directories: createLocalConversationDirectoryPort({ storageRoot: root }),
    facts: {
      exists: async () => false,
      ensure: async () => {},
    },
  };
}

function createScope(input: {
  readonly cleanupJobs: SqliteConversationDirectoryCleanupJobPort;
  readonly directories: ConversationDirectoryPort;
  readonly facts: ConversationFactsPort;
}): ConversationLifecycleApplicationScope {
  return createConversationLifecycleApplicationScope(input);
}

function createBlocker(): {
  readonly promise: Promise<void>;
  readonly release: () => void;
} {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

afterEach(async () => {
  for (const db of testDatabases.splice(0)) {
    if (db.open) {
      db.close();
    }
  }
  await Promise.all(testRoots.splice(0).map(root => fsp.rm(root, {
    recursive: true,
    force: true,
  })));
});

describe('conversation work directory admission', () => {
  it('持久 cleanup job 在数据库连接和内存 gate 重建后仍阻止 mkdir 和 admission callback', async () => {
    const fixture = await createFixture('restart-barrier');
    const identity = deriveConversationWorkDirectoryIdentity('admission-restart-barrier');
    const job = createConversationDirectoryCleanupJob({
      jobId: 'conversation_cleanup_00000000-0000-4000-8000-000000000001',
      identity,
      operation: 'delete_conversation',
      requestedAt: 1_785_499_200_000,
    });
    await fixture.cleanupJobs.begin(job);
    fixture.db.close();

    const restartedDb = new Database(path.join(fixture.root, 'workspace.sqlite'));
    testDatabases.push(restartedDb);
    const restartedJobs = new SqliteConversationDirectoryCleanupJobPort(restartedDb);
    const directories = createLocalConversationDirectoryPort({ storageRoot: fixture.root });
    const scope = createScope({
      cleanupJobs: restartedJobs,
      directories,
      facts: fixture.facts,
    });
    let callbackCalled = false;

    await expect(scope.workDirectoryAdmission.withAdmission({
      conversationId: identity.conversationId,
    }, () => {
        callbackCalled = true;
    })).rejects.toMatchObject({
      code: 'work_directory_cleanup_in_progress',
      stage: 'check_cleanup_barrier',
    });
    expect(callbackCalled).toBe(false);
    await expect(fsp.lstat(directories.resolvePath(identity))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    restartedDb.close();
  });

  it('cleanup 不能越过正在建立 owner 的 admission，job 落盘后后续 admission 被拒绝', async () => {
    const fixture = await createFixture('serialized-race');
    const identity = deriveConversationWorkDirectoryIdentity('admission-serialized-race');
    const scope = createScope(fixture);
    const blocker = createBlocker();
    const admissionEntered = createBlocker();

    const admission = scope.workDirectoryAdmission.withAdmission({
      conversationId: identity.conversationId,
    }, async directory => {
        admissionEntered.release();
        await blocker.promise;
        return directory;
    });

    await admissionEntered.promise;

    const cleanup = scope.gate.runExclusive({
      scope: {
        conversationId: identity.conversationId,
        operation: 'directory_cleanup_job',
      },
      run: () => fixture.cleanupJobs.begin(createConversationDirectoryCleanupJob({
        jobId: 'conversation_cleanup_00000000-0000-4000-8000-000000000002',
        identity,
        operation: 'clear_work_directory',
        requestedAt: 1_785_499_200_100,
      })),
    });

    await Promise.resolve();
    await expect(fixture.cleanupJobs.read(identity.conversationId)).resolves.toBeNull();
    blocker.release();
    await expect(admission).resolves.toMatchObject({
      identity,
      status: 'created',
    });
    await expect(cleanup).resolves.toMatchObject({ status: 'created' });
    await expect(scope.workDirectoryAdmission.withAdmission({
      conversationId: identity.conversationId,
    }, directory => directory)).rejects.toMatchObject({
      code: 'work_directory_cleanup_in_progress',
      stage: 'check_cleanup_barrier',
    });
    fixture.db.close();
  });

  it('admission callback 失败后释放 gate，下一次同对话准入仍可完成', async () => {
    const fixture = await createFixture('callback-failure');
    const scope = createScope(fixture);
    const conversationId = 'admission-callback-failure';
    const callbackError = new Error('owner reservation failed');

    await expect(scope.workDirectoryAdmission.withAdmission({
      conversationId,
    }, () => {
      throw callbackError;
    })).rejects.toBe(callbackError);

    await expect(scope.workDirectoryAdmission.withAdmission({
      conversationId,
    }, directory => directory)).resolves.toMatchObject({
      status: 'existing',
    });
    fixture.db.close();
  });
});
