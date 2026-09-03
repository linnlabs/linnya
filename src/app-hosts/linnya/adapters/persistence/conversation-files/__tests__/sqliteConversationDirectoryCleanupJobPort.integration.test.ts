import Database from 'better-sqlite3';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createConversationDirectoryCleanupJob,
  deriveConversationWorkDirectoryIdentity,
  type ConversationDirectoryCleanupOperation,
} from '../../../../../../domains/conversation-files';
import { CONVERSATION_DIRECTORY_CLEANUP_JOB_SCHEMA } from '../conversationCleanupJob.schema';
import { SqliteConversationDirectoryCleanupJobPort } from '../sqliteConversationDirectoryCleanupJobPort';

const testRoots: string[] = [];

async function createDatabasePath(label: string): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), `linnya-cleanup-job-${label}-`));
  testRoots.push(root);
  return path.join(root, 'workspace.sqlite');
}

function openDatabase(databasePath: string): Database.Database {
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');
  for (const ddl of CONVERSATION_DIRECTORY_CLEANUP_JOB_SCHEMA) {
    db.exec(ddl);
  }
  return db;
}

function createJob(input: {
  readonly jobSequence: number;
  readonly conversationId: string;
  readonly operation: ConversationDirectoryCleanupOperation;
  readonly requestedAt: number;
}) {
  return createConversationDirectoryCleanupJob({
    jobId: `conversation_cleanup_00000000-0000-4000-8000-${input.jobSequence.toString().padStart(12, '0')}`,
    identity: deriveConversationWorkDirectoryIdentity(input.conversationId),
    operation: input.operation,
    requestedAt: input.requestedAt,
  });
}

afterEach(async () => {
  await Promise.all(testRoots.splice(0).map(root => fsp.rm(root, {
    recursive: true,
    force: true,
  })));
});

describe('SQLite conversation directory cleanup job persistence', () => {
  it('跨数据库重启恢复任务，且不被 conversation 外键级联删除', async () => {
    const databasePath = await createDatabasePath('restart');
    const firstDb = openDatabase(databasePath);
    const firstPort = new SqliteConversationDirectoryCleanupJobPort(firstDb);
    const requested = createJob({
      jobSequence: 1,
      conversationId: 'cleanup-restart',
      operation: 'delete_conversation',
      requestedAt: 1_785_499_200_000,
    });

    await expect(firstPort.begin(requested)).resolves.toEqual({
      status: 'created',
      job: requested,
    });
    expect(firstDb.pragma('foreign_key_list(conversation_directory_cleanup_jobs)'))
      .toEqual([]);
    firstDb.close();

    const restartedDb = openDatabase(databasePath);
    const restartedPort = new SqliteConversationDirectoryCleanupJobPort(restartedDb);
    await expect(restartedPort.read(requested.conversationId)).resolves.toEqual(requested);
    restartedDb.close();
  });

  it('复用相同请求并只允许从清理目录升级为删除对话', async () => {
    const databasePath = await createDatabasePath('merge');
    const db = openDatabase(databasePath);
    const port = new SqliteConversationDirectoryCleanupJobPort(db);
    const clear = createJob({
      jobSequence: 1,
      conversationId: 'cleanup-merge',
      operation: 'clear_work_directory',
      requestedAt: 100,
    });
    await port.begin(clear);
    const failed = await port.recordFailure({
      jobId: clear.jobId,
      conversationId: clear.conversationId,
      operation: clear.operation,
      failure: {
        code: 'work_directory_in_use',
        stage: 'delete_work_directory',
      },
    });

    const repeated = createJob({
      jobSequence: 2,
      conversationId: 'cleanup-merge',
      operation: 'clear_work_directory',
      requestedAt: 200,
    });
    await expect(port.begin(repeated)).resolves.toEqual({
      status: 'existing',
      job: failed,
    });

    const deletion = createJob({
      jobSequence: 3,
      conversationId: 'cleanup-merge',
      operation: 'delete_conversation',
      requestedAt: 300,
    });
    const upgraded = await port.begin(deletion);
    expect(upgraded).toEqual({
      status: 'upgraded',
      job: {
        ...failed,
        operation: 'delete_conversation',
      },
    });
    await expect(port.begin(repeated)).resolves.toEqual({
      status: 'existing',
      job: upgraded.job,
    });
    db.close();
  });

  it('升级后拒绝旧 operation 的失败记录和完成动作', async () => {
    const databasePath = await createDatabasePath('stale-operation');
    const db = openDatabase(databasePath);
    const port = new SqliteConversationDirectoryCleanupJobPort(db);
    const clear = createJob({
      jobSequence: 1,
      conversationId: 'cleanup-stale',
      operation: 'clear_work_directory',
      requestedAt: 100,
    });
    await port.begin(clear);
    const deletion = createJob({
      jobSequence: 2,
      conversationId: 'cleanup-stale',
      operation: 'delete_conversation',
      requestedAt: 200,
    });
    const upgraded = await port.begin(deletion);

    await expect(port.recordFailure({
      jobId: clear.jobId,
      conversationId: clear.conversationId,
      operation: 'clear_work_directory',
      failure: {
        code: 'stale_clear_failure',
        stage: 'delete_work_directory',
      },
    })).resolves.toBeNull();
    await expect(port.complete({
      jobId: clear.jobId,
      conversationId: clear.conversationId,
      operation: 'clear_work_directory',
    })).resolves.toBe(false);
    await expect(port.read(clear.conversationId)).resolves.toEqual(upgraded.job);

    const failed = await port.recordFailure({
      jobId: upgraded.job.jobId,
      conversationId: clear.conversationId,
      operation: 'delete_conversation',
      failure: {
        code: 'conversation_activity_still_running',
        stage: 'stop_conversation_activity',
      },
    });
    expect(failed).toMatchObject({
      operation: 'delete_conversation',
      retryCount: 1,
    });
    await expect(port.complete({
      jobId: upgraded.job.jobId,
      conversationId: clear.conversationId,
      operation: 'delete_conversation',
    })).resolves.toBe(true);
    await expect(port.complete({
      jobId: upgraded.job.jobId,
      conversationId: clear.conversationId,
      operation: 'delete_conversation',
    })).resolves.toBe(false);
    db.close();
  });

  it('同一 operation 的下一代任务不受旧 worker 迟到回调影响', async () => {
    const databasePath = await createDatabasePath('stale-generation');
    const db = openDatabase(databasePath);
    const port = new SqliteConversationDirectoryCleanupJobPort(db);
    const first = createJob({
      jobSequence: 1,
      conversationId: 'cleanup-generation',
      operation: 'clear_work_directory',
      requestedAt: 100,
    });
    await port.begin(first);
    await expect(port.complete({
      jobId: first.jobId,
      conversationId: first.conversationId,
      operation: first.operation,
    })).resolves.toBe(true);

    const second = createJob({
      jobSequence: 2,
      conversationId: 'cleanup-generation',
      operation: 'clear_work_directory',
      requestedAt: 200,
    });
    await expect(port.begin(second)).resolves.toEqual({
      status: 'created',
      job: second,
    });
    await expect(port.recordFailure({
      jobId: first.jobId,
      conversationId: first.conversationId,
      operation: first.operation,
      failure: {
        code: 'stale_worker_failure',
        stage: 'delete_work_directory',
      },
    })).resolves.toBeNull();
    await expect(port.complete({
      jobId: first.jobId,
      conversationId: first.conversationId,
      operation: first.operation,
    })).resolves.toBe(false);
    await expect(port.read(second.conversationId)).resolves.toEqual(second);
    db.close();
  });

  it('按稳定顺序列出恢复任务，并对损坏的失败事实明确报错', async () => {
    const databasePath = await createDatabasePath('list-corrupt');
    const db = openDatabase(databasePath);
    const port = new SqliteConversationDirectoryCleanupJobPort(db);
    const later = createJob({
      jobSequence: 1,
      conversationId: 'cleanup-later',
      operation: 'clear_work_directory',
      requestedAt: 200,
    });
    const firstB = createJob({
      jobSequence: 2,
      conversationId: 'cleanup-first-b',
      operation: 'delete_conversation',
      requestedAt: 100,
    });
    const firstA = createJob({
      jobSequence: 3,
      conversationId: 'cleanup-first-a',
      operation: 'clear_work_directory',
      requestedAt: 100,
    });
    await port.begin(later);
    await port.begin(firstB);
    await port.begin(firstA);

    await expect(port.list()).resolves.toEqual([firstA, firstB, later]);

    db.prepare(`
      UPDATE conversation_directory_cleanup_jobs
      SET last_failure_json = '{broken'
      WHERE conversation_id = ?
    `).run(later.conversationId);
    await expect(port.read(later.conversationId)).rejects.toMatchObject({
      code: 'cleanup_job_corrupt',
      stage: 'read',
    });
    db.close();
  });
});
