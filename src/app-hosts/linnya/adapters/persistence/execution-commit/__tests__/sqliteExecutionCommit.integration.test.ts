import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { execution, graph } from '@linnlabs/linnkit/runtime-kernel';
import { RunIdSchema, ToolCallIdSchema, createToolOutputEvent } from '@linnlabs/linnkit/contracts';
import { CONVERSATION_SCHEMAS } from '../../event-store/conversation.schema';
import { ENGINE_CHECKPOINTS_SCHEMA } from '../../checkpointer/checkpointer.schema';
import { RUN_DESCRIPTORS_SCHEMA } from '../../run-descriptors/schema-providers';
import { SQLiteEventStore, LinnyaEventStoreAdapter } from '../../event-store';
import { SqliteCheckpointer } from '../../checkpointer';
import { SQLiteRunRegistryStore } from '../../run-registry';
import { SqliteExecutionCommit, SqliteToolResultReceipts } from '../index';

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

async function createReceiptRuntime(inFlightCallIds: readonly string[] = ['original-call']) {
  const runtime = await createRuntime();
  runtime.db.prepare('INSERT INTO agent_run_descriptors (run_id, descriptor_json) VALUES (?, ?)')
    .run(runId, '{}');
  await runtime.checkpoints.save(runId, {
    ...runtime.checkpoint,
    executionStatus: 'executing',
    local: {
      executingToolCallIds: inFlightCallIds.map(id => ToolCallIdSchema.parse(id)),
      pendingToolCalls: inFlightCallIds.map(id => ({ id: ToolCallIdSchema.parse(id),
        type: 'function' as const, function: { name: 'lookup', arguments: '{}' } })),
    },
  });
  const receipts = new SqliteToolResultReceipts(runtime.db);
  return { ...runtime, receipts, port: receipts.forExecution(runId, 'attempt-1') };
}

describe('EventBus → SQLite execution checkpoint commit', () => {
  it('取消返回不改原子结果，仍拒绝动作写入、旧 execution 和已清理的调用', async () => {
    const runtime = await createReceiptRuntime();
    runtime.db.transaction(() => {
      runtime.port.prepare('original-call', 'lookup');
      runtime.port.commit('original-call', 'lookup', 'original result');
    })();
    const current = await runtime.runs.load(runId);
    if (!current) throw new Error('Missing run');
    await runtime.runs.save({ ...current, status: 'cancelled', updatedAt: 2 });
    expect(() => runtime.port.returned('original-call', 'lookup', 'original result')).not.toThrow();
    expect(() => runtime.port.returned('original-call', 'lookup', 'changed result'))
      .toThrow('Original tool result cannot be overwritten');
    expect(() => runtime.port.prepare('original-call', 'lookup')).toThrow('no longer owns run');
    expect(() => runtime.port.commit('original-call', 'lookup', 'original result'))
      .toThrow('no longer owns run');
    expect(() => runtime.receipts.forExecution(runId, 'other-attempt')
      .returned('original-call', 'lookup', 'original result')).toThrow('no longer owns run');
    await runtime.checkpoints.clear(runId);
    expect(() => runtime.port.returned('original-call', 'lookup', 'original result'))
      .toThrow('no committed execution intent');
    expect(runtime.receipts.read(runId, 'original-call', 'lookup'))
      .toMatchObject({ result: 'original result', atomic_owner: 1 });
  });

  it('并行组的多个在途调用各自保存凭据，已结算或不在途的调用仍被拒绝', async () => {
    const runtime = await createReceiptRuntime(['call-a', 'call-b']);
    // 两个调用同时在途时，后完成的先提交也必须被接纳；守卫按在途集合而不是唯一调用判断。
    runtime.port.returned('call-b', 'lookup', 'result b');
    runtime.port.returned('call-a', 'lookup', 'result a');
    expect(runtime.receipts.read(runId, 'call-a', 'lookup')).toMatchObject({ result: 'result a' });
    expect(runtime.receipts.read(runId, 'call-b', 'lookup')).toMatchObject({ result: 'result b' });
    expect(() => runtime.port.returned('call-c', 'lookup', 'result c'))
      .toThrow('no committed execution intent');

    // call-b 结算后离开在途集合；它的迟到凭据不能再写入。
    const settled = await runtime.checkpoints.load(runId);
    if (!settled?.local) throw new Error('Missing checkpoint');
    await runtime.checkpoints.save(runId, {
      ...settled,
      local: {
        ...settled.local,
        executingToolCallIds: [ToolCallIdSchema.parse('call-a')],
        pendingToolCalls: settled.local.pendingToolCalls?.filter(call => call.id === 'call-a'),
      },
    });
    expect(() => runtime.port.returned('call-b', 'lookup', 'result b'))
      .toThrow('no committed execution intent');
    expect(() => runtime.port.returned('call-a', 'lookup', 'result a')).not.toThrow();
  });

  it('返回结果的真实存储错误继续报告，不伪装成取消或完成', async () => {
    const runtime = await createReceiptRuntime();
    runtime.db.exec(`CREATE TRIGGER reject_returned BEFORE INSERT ON agent_tool_results
      BEGIN SELECT RAISE(ABORT, 'receipt storage unavailable'); END;`);
    expect(() => runtime.port.returned('original-call', 'lookup', 'real result'))
      .toThrow('receipt storage unavailable');
    expect(runtime.receipts.read(runId, 'original-call', 'lookup')).toBeUndefined();
    expect((await runtime.runs.load(runId))?.status).toBe('running');
  });

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

  it('取消收尾提交原工具结果一次，动作权限不恢复；清理后不能复活断点', async () => {
    const runtime = await createRuntime();
    await runtime.checkpoints.save(runId, { ...runtime.checkpoint, revision: 1, executionStatus: 'executing' });
    const current = await runtime.runs.load(runId);
    if (!current) throw new Error('Missing run');
    await runtime.runs.save({ ...current, status: 'cancelled', updatedAt: 2 });
    expect(() => runtime.runs.requireExecutionOwner(runId, 'attempt-1')).toThrow('no longer owns run');
    const fact = runtime.publishResult();
    const terminal = { ...runtime.checkpoint, executionStatus: 'yielded' as const, local: { pendingToolCalls: [] } };
    await runtime.persistence.commitCheckpoint(runId, terminal);
    expect((await runtime.eventStore.range(conversationId)).map(row => row.event)).toEqual([fact]);
    const writer = new SqliteExecutionCommit(runtime.db).forExecution(runId, 'attempt-1');
    await expect(writer({ checkpointKey: runId, checkpoint: { ...terminal, revision: 3 }, events: [] }))
      .rejects.toThrow('invalid cancellation settlement boundary');
    await runtime.checkpoints.clear(runId);
    await expect(writer({ checkpointKey: runId, checkpoint: terminal, events: [] }))
      .rejects.toThrow('invalid cancellation settlement boundary');
    expect(await runtime.checkpoints.load(runId)).toBeNull();
  });
});
