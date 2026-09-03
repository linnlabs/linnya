import Database from 'better-sqlite3';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import type { RuntimeEvent } from '@linnlabs/linnkit/contracts';

import {
  createConversationDirectoryCleanupJob,
  deriveConversationWorkDirectoryIdentity,
  type ConversationDirectoryPort,
} from '../../../../../domains/conversation-files';
import { createLocalConversationDirectoryPort } from '../../../../../infra/adapters/conversation-files/local-directory';
import { createEventStoreConversationFactsPort } from '../../../adapters/persistence/conversation-facts';
import {
  CONVERSATION_DIRECTORY_CLEANUP_JOB_SCHEMA,
  SqliteConversationDirectoryCleanupJobPort,
} from '../../../adapters/persistence/conversation-files';
import { CONVERSATION_SCHEMAS } from '../../../adapters/persistence/event-store/conversation.schema';
import { SQLiteEventStore } from '../../../adapters/persistence/event-store';
import { CORE_SCHEMAS } from '../../../../../features/workspace/infrastructure/sqlite/schemas/core.schema';
import type { ConversationFactsPort } from '../definitions/conversationFactsPort';
import type {
  ConversationPersistenceAdmission,
  ConversationPersistenceAdmissionInput,
} from '../definitions/conversationPersistenceAdmission';
import {
  createConversationLifecycleApplicationScope,
  type ConversationLifecycleApplicationScope,
} from '../orchestration/createConversationLifecycleApplicationScope';

const testRoots: string[] = [];
const testDatabases: Database.Database[] = [];

async function createFixture(label: string): Promise<{
  readonly root: string;
  readonly db: Database.Database;
  readonly eventStore: SQLiteEventStore;
  readonly cleanupJobs: SqliteConversationDirectoryCleanupJobPort;
  readonly directories: ConversationDirectoryPort;
  readonly facts: ConversationFactsPort;
}> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), `linnya-persistent-admission-${label}-`));
  testRoots.push(root);
  const db = new Database(path.join(root, 'workspace.sqlite'));
  testDatabases.push(db);
  db.pragma('foreign_keys = ON');
  for (const ddl of [
    ...CORE_SCHEMAS,
    ...CONVERSATION_SCHEMAS,
    ...CONVERSATION_DIRECTORY_CLEANUP_JOB_SCHEMA,
  ]) {
    db.exec(ddl);
  }
  const eventStore = new SQLiteEventStore(db);
  return {
    root,
    db,
    eventStore,
    cleanupJobs: new SqliteConversationDirectoryCleanupJobPort(db),
    directories: createLocalConversationDirectoryPort({ storageRoot: root }),
    facts: createEventStoreConversationFactsPort(eventStore),
  };
}

function createUserInput(conversationId: string, content: string): RuntimeEvent {
  return {
    id: `message-${conversationId}`,
    type: 'user_input',
    timestamp: 1_785_499_200_000,
    conversation_id: conversationId,
    turn_id: `turn-${conversationId}`,
    version: 1,
    content,
    source: 'user',
  };
}

function admit(
  scope: ConversationLifecycleApplicationScope,
  input: ConversationPersistenceAdmissionInput,
): Promise<ConversationPersistenceAdmission> {
  return scope.persistenceAdmission.withAdmission(input, admission => admission);
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

describe('persistent conversation admission', () => {
  it('区分新对话、已有目录和只有数据库事实的历史对话', async () => {
    const fixture = await createFixture('state-projection');
    const scope = createConversationLifecycleApplicationScope(fixture);
    const newConversationId = 'persistent-admission-new';

    const created = await admit(scope, {
      conversationId: newConversationId,
      initialEvents: [createUserInput(newConversationId, '新对话标题')],
    });
    expect(created).toMatchObject({
      conversationStatus: 'created',
      workFilesStatus: 'ready',
      directory: { status: 'created' },
    });
    await fsp.writeFile(path.join(created.directory.absolutePath, 'kept.txt'), 'kept', 'utf8');

    const existing = await admit(scope, {
      conversationId: newConversationId,
      initialEvents: [],
    });
    expect(existing).toMatchObject({
      conversationStatus: 'existing',
      workFilesStatus: 'ready',
      directory: { status: 'existing' },
    });
    await expect(fsp.readFile(path.join(existing.directory.absolutePath, 'kept.txt'), 'utf8'))
      .resolves.toBe('kept');

    const historicalConversationId = 'persistent-admission-history-only';
    await fixture.eventStore.ensureConversation(
      historicalConversationId,
      [createUserInput(historicalConversationId, '历史对话标题')],
    );
    const historical = await admit(scope, {
      conversationId: historicalConversationId,
      initialEvents: [],
    });
    expect(historical).toMatchObject({
      conversationStatus: 'existing',
      workFilesStatus: 'historical_files_unavailable',
      directory: { status: 'created' },
    });
    await expect(fixture.eventStore.getConversationMetadata(historicalConversationId))
      .resolves.toMatchObject({
        title: 'New Chat',
        preview_text: '历史对话标题',
      });
  });

  it('目录初始化后被删除时返回旧工作文件不可用，并只重建空目录', async () => {
    const fixture = await createFixture('missing-files');
    const scope = createConversationLifecycleApplicationScope(fixture);
    const conversationId = 'persistent-admission-missing-files';
    const first = await admit(scope, {
      conversationId,
      initialEvents: [createUserInput(conversationId, '保留聊天事实')],
    });
    await fsp.writeFile(path.join(first.directory.absolutePath, 'lost.txt'), 'lost', 'utf8');
    await fsp.rm(first.directory.absolutePath, { recursive: true });

    const restored = await admit(scope, {
      conversationId,
      initialEvents: [],
    });
    expect(restored).toMatchObject({
      conversationStatus: 'existing',
      workFilesStatus: 'previous_files_unavailable',
      directory: { status: 'recreated_missing' },
    });
    await expect(fsp.readdir(restored.directory.absolutePath)).resolves.toEqual([]);
    await expect(fixture.eventStore.getConversationMetadata(conversationId))
      .resolves.toMatchObject({
        title: 'New Chat',
        preview_text: '保留聊天事实',
      });
  });

  it('cleanup job 在任何目录和对话事实写入前拒绝准入', async () => {
    const fixture = await createFixture('cleanup-barrier');
    const scope = createConversationLifecycleApplicationScope(fixture);
    const conversationId = 'persistent-admission-cleanup';
    const identity = deriveConversationWorkDirectoryIdentity(conversationId);
    await fixture.cleanupJobs.begin(createConversationDirectoryCleanupJob({
      jobId: 'conversation_cleanup_00000000-0000-4000-8000-000000000003',
      identity,
      operation: 'delete_conversation',
      requestedAt: 1_785_499_200_200,
    }));

    await expect(admit(scope, {
      conversationId,
      initialEvents: [createUserInput(conversationId, '不应写入')],
    })).rejects.toMatchObject({
      code: 'work_directory_cleanup_in_progress',
      stage: 'check_cleanup_barrier',
    });
    await expect(fixture.eventStore.getConversationMetadata(conversationId)).resolves.toBeNull();
    await expect(fsp.lstat(fixture.directories.resolvePath(identity))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('数据库 ensure 失败后保留已发布目录，重试时不丢其中的工作文件', async () => {
    const fixture = await createFixture('ensure-retry');
    const conversationId = 'persistent-admission-ensure-retry';
    let remainingFailures = 1;
    const failingFacts: ConversationFactsPort = {
      exists: id => fixture.facts.exists(id),
      async ensure(input): Promise<void> {
        if (remainingFailures > 0) {
          remainingFailures -= 1;
          throw new Error('injected_conversation_write_failure');
        }
        await fixture.facts.ensure(input);
      },
    };
    const scope = createConversationLifecycleApplicationScope({
      cleanupJobs: fixture.cleanupJobs,
      directories: fixture.directories,
      facts: failingFacts,
    });
    const identity = deriveConversationWorkDirectoryIdentity(conversationId);

    await expect(admit(scope, {
      conversationId,
      initialEvents: [createUserInput(conversationId, '重试标题')],
    })).rejects.toThrow('injected_conversation_write_failure');
    const publishedPath = fixture.directories.resolvePath(identity);
    await fsp.writeFile(path.join(publishedPath, 'between-retries.txt'), 'preserved', 'utf8');
    await expect(fixture.eventStore.getConversationMetadata(conversationId)).resolves.toBeNull();

    const retried = await admit(scope, {
      conversationId,
      initialEvents: [createUserInput(conversationId, '重试标题')],
    });
    expect(retried).toMatchObject({
      conversationStatus: 'created',
      workFilesStatus: 'ready',
      directory: { status: 'existing' },
    });
    await expect(fsp.readFile(path.join(publishedPath, 'between-retries.txt'), 'utf8'))
      .resolves.toBe('preserved');
  });

  it('同一 App-owner scope 的并发准入依序观察对话事实并共享目录', async () => {
    const fixture = await createFixture('concurrent');
    const scope = createConversationLifecycleApplicationScope(fixture);
    const conversationId = 'persistent-admission-concurrent';

    const [first, second, third] = await Promise.all(Array.from({ length: 3 }, () => (
      admit(scope, {
        conversationId,
        initialEvents: [createUserInput(conversationId, '并发标题')],
      })
    )));

    expect([first, second, third].map(result => result.conversationStatus))
      .toEqual(['created', 'existing', 'existing']);
    expect([first, second, third].map(result => result.directory.status))
      .toEqual(['created', 'existing', 'existing']);
    expect(new Set([first, second, third].map(result => result.directory.absolutePath)).size)
      .toBe(1);
  });

  it('准入回调未完成时不允许同一对话建立 cleanup job', async () => {
    const fixture = await createFixture('callback-barrier');
    const scope = createConversationLifecycleApplicationScope(fixture);
    const conversationId = 'persistent-admission-callback-barrier';
    const identity = deriveConversationWorkDirectoryIdentity(conversationId);
    let signalCallbackStarted: (() => void) | undefined;
    let releaseCallback: (() => void) | undefined;
    const callbackStarted = new Promise<void>(resolve => {
      signalCallbackStarted = resolve;
    });
    const callbackRelease = new Promise<void>(resolve => {
      releaseCallback = resolve;
    });

    const admission = scope.persistenceAdmission.withAdmission({
      conversationId,
      initialEvents: [createUserInput(conversationId, '登记活动 run')],
    }, async () => {
      signalCallbackStarted?.();
      await callbackRelease;
      return 'owner_registered';
    });
    await callbackStarted;

    const cleanup = scope.gate.runExclusive({
      scope: {
        conversationId: identity.conversationId,
        operation: 'directory_cleanup_job',
      },
      run: () => fixture.cleanupJobs.begin(createConversationDirectoryCleanupJob({
        jobId: 'conversation_cleanup_00000000-0000-4000-8000-000000000004',
        identity,
        operation: 'delete_conversation',
        requestedAt: 1_785_499_200_300,
      })),
    });

    await expect(fixture.cleanupJobs.read(identity.conversationId)).resolves.toBeNull();
    releaseCallback?.();
    await expect(admission).resolves.toBe('owner_registered');
    await expect(cleanup).resolves.toMatchObject({ status: 'created' });
    await expect(fixture.cleanupJobs.read(identity.conversationId)).resolves.toMatchObject({
      operation: 'delete_conversation',
    });
  });
});
