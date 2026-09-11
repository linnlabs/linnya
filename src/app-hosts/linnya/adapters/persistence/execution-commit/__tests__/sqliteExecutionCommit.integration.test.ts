import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { execution, graph } from '@linnlabs/linnkit/runtime-kernel';
import { RunIdSchema, createToolOutputEvent } from '@linnlabs/linnkit/contracts';
import { CONVERSATION_SCHEMAS } from '../../event-store/conversation.schema';
import { ENGINE_CHECKPOINTS_SCHEMA } from '../../checkpointer/checkpointer.schema';
import { RUN_DESCRIPTORS_SCHEMA } from '../../run-descriptors/schema-providers';
import { SQLiteEventStore, LinnyaEventStoreAdapter } from '../../event-store';
import { SqliteCheckpointer } from '../../checkpointer';
import { SQLiteRunRegistryStore } from '../../run-registry';
import { SqliteExecutionCommit } from '../index';

const runId = RunIdSchema.parse('run-recovery');
const conversationId = 'conversation-recovery';
const temporaryDirectories: string[] = [];
const databases: Database.Database[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) if (db.open) db.close();
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

async function createRuntime() {
  const directory = mkdtempSync(join(tmpdir(), 'linnya-execution-commit-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'workspace.sqlite');
  const db = new Database(path);
  databases.push(db);
  db.pragma('journal_mode = WAL');
  db.exec(
    'CREATE TABLE projects (id TEXT PRIMARY KEY); CREATE TABLE assets (id TEXT PRIMARY KEY);'
  );
  for (const ddl of [
    ...CONVERSATION_SCHEMAS,
    ...ENGINE_CHECKPOINTS_SCHEMA,
    ...RUN_DESCRIPTORS_SCHEMA,
  ])
    db.exec(ddl);
  const host = new SQLiteEventStore(db);
  await host.ensureConversation(conversationId, [], undefined, 'agent');
  const runs = new SQLiteRunRegistryStore(db);
  await runs.save({
    runId,
    conversationId,
    status: 'running',
    startedAt: 1,
    updatedAt: 1,
    metadata: { executionId: 'attempt-1' },
  });
  const eventStore = new LinnyaEventStoreAdapter(db, host);
  const sequencer = new execution.EventSequencer(conversationId);
  const bus = new execution.EventBus(sequencer.getExecutionId());
  const publisher = new execution.RuntimeEventPublisher(bus, sequencer, {
    run_id: runId,
    lane: 'foreground',
    visibility: 'conversation',
  });
  const persistence = new execution.EventBusEventPersistence({
    eventBus: bus,
    eventStore,
    nextEventStoreId: graph.createMonotonicEventStoreIdFactory(),
    checkpointWriter: new SqliteExecutionCommit(db).forExecution(runId, 'attempt-1'),
  });
  persistence.connect();
  const checkpoints = new SqliteCheckpointer(db);
  const checkpoint: graph.EngineState = {
    nodeId: 'llm',
    revision: 2,
    executionStatus: 'ready',
    local: { executorLocal: { stepCount: 3 } },
  };
  const publishResult = () =>
    publisher.publish(
      createToolOutputEvent(
        'terminal-tool-result',
        conversationId,
        'original-turn',
        'lookup',
        'original-call',
        { status: 'success', observation: 'Original result', data: null }
      ),
      'ToolNode'
    );
  return { db, path, runs, eventStore, persistence, checkpoints, checkpoint, publishResult };
}

describe('EventBus → SQLite execution checkpoint commit', () => {
  it('提交原工具结果与断点，重新打开数据库后两者及 UI 投影同时可见', async () => {
    const runtime = await createRuntime();
    const fact = runtime.publishResult();
    await runtime.persistence.drain();
    expect(await runtime.eventStore.range(conversationId)).toEqual([]);
    await runtime.persistence.commitCheckpoint(runId, runtime.checkpoint);
    runtime.db.close();

    const reopened = new Database(runtime.path);
    databases.push(reopened);
    const events = new LinnyaEventStoreAdapter(reopened, new SQLiteEventStore(reopened));
    expect((await events.range(conversationId)).map(row => row.event)).toEqual([fact]);
    expect(await new SqliteCheckpointer(reopened).load(runId)).toMatchObject(runtime.checkpoint);
    expect(reopened.prepare('SELECT run_id FROM conversation_ui_messages').all()).toEqual([
      { run_id: runId },
    ]);
  });

  it('断点磁盘写入失败回滚本批事实、UI 和统计，不保留超前结果', async () => {
    const runtime = await createRuntime();
    await runtime.checkpoints.save(runId, { ...runtime.checkpoint, revision: 1 });
    runtime.db.exec(`CREATE TRIGGER reject_checkpoint BEFORE INSERT ON engine_checkpoints
      BEGIN SELECT RAISE(ABORT, 'checkpoint write unavailable'); END;`);
    runtime.publishResult();
    await expect(runtime.persistence.commitCheckpoint(runId, runtime.checkpoint)).rejects.toThrow(
      'checkpoint write unavailable'
    );
    expect(await runtime.eventStore.range(conversationId)).toEqual([]);
    expect(runtime.db.prepare('SELECT message_id FROM conversation_ui_messages').all()).toEqual([]);
    expect(await runtime.checkpoints.load(runId)).toMatchObject({ revision: 1 });
  });

  it('事件写入失败不允许断点跳过尚未提交的结果', async () => {
    const runtime = await createRuntime();
    runtime.db.exec(`CREATE TRIGGER reject_fact BEFORE INSERT ON events
      BEGIN SELECT RAISE(ABORT, 'fact write unavailable'); END;`);
    runtime.publishResult();
    await expect(runtime.persistence.commitCheckpoint(runId, runtime.checkpoint)).rejects.toThrow();
    expect(await runtime.checkpoints.load(runId)).toBeNull();
  });

  it('暂停收口可以提交，但新 activation 接管后旧 attempt 的迟到提交必须失败', async () => {
    const runtime = await createRuntime();
    const current = await runtime.runs.load(runId);
    if (!current) throw new Error('Missing run');
    const pausing = { ...current, status: 'paused' as const, pauseReason: 'user', updatedAt: 2 };
    expect(await runtime.runs.compareAndSwap(current, pausing)).toBe(true);
    await runtime.persistence.commitCheckpoint(runId, runtime.checkpoint);
    expect(
      await runtime.runs.compareAndSwap(pausing, {
        ...pausing,
        status: 'running',
        updatedAt: 3,
        metadata: { executionId: 'attempt-2' },
      })
    ).toBe(true);
    runtime.publishResult();
    await expect(
      runtime.persistence.commitCheckpoint(runId, { ...runtime.checkpoint, revision: 3 })
    ).rejects.toThrow('no longer owns run');
    expect(await runtime.eventStore.range(conversationId)).toEqual([]);
    expect(await runtime.checkpoints.load(runId)).toMatchObject({ revision: 2 });
  });

  it.each(['paused', 'cancelled', 'completed'] as const)(
    '已结算 %s 状态拒绝旧执行写入',
    async status => {
      const runtime = await createRuntime();
      const current = await runtime.runs.load(runId);
      if (!current) throw new Error('Missing run');
      await runtime.runs.save({ ...current, status, pausedAt: 2, updatedAt: 2 });
      runtime.publishResult();
      await expect(runtime.persistence.commitCheckpoint(runId, runtime.checkpoint)).rejects.toThrow(
        'no longer owns run'
      );
      expect(await runtime.checkpoints.load(runId)).toBeNull();
      expect(await runtime.eventStore.range(conversationId)).toEqual([]);
    }
  );
});
