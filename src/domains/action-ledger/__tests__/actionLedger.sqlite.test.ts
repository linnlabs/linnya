import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { ACTION_LEDGER_SCHEMAS } from '../infrastructure/sqlite/actionLedger.schema';
import { createSqliteActionLedger } from '../infrastructure/sqlite/createSqliteActionLedger';
import { resolveToolRunActor } from '../functions/resolveToolRunActor';
import type { ActionRunActor } from '../definitions/actionLedger';

const databases: Database.Database[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function createDb(): Database.Database {
  const db = new Database(':memory:');
  databases.push(db);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE workspace_nodes (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE
    );
    INSERT INTO projects (id) VALUES ('p1'), ('p2');
    INSERT INTO workspace_nodes (id, project_id) VALUES ('doc-a', 'p1'), ('doc-b', 'p1'), ('doc-c', 'p2');
  `);
  for (const statement of ACTION_LEDGER_SCHEMAS) db.exec(statement);
  return db;
}

function clock(start = 1_000): () => number {
  let current = start;
  return () => (current += 10);
}

const rootRun: ActionRunActor = {
  kind: 'run', runId: 'run-1', rootRunId: 'run-1', parentRunId: null, conversationId: 'conv-1', toolCallId: 'call-1',
};
const childRun: ActionRunActor = {
  kind: 'subrun', runId: 'run-1-child', rootRunId: 'run-1', parentRunId: 'run-1', conversationId: 'conv-1', toolCallId: 'call-2',
};
const grandchildRun: ActionRunActor = {
  kind: 'subrun', runId: 'run-1-grandchild', rootRunId: 'run-1', parentRunId: 'run-1-child', conversationId: 'conv-1', toolCallId: 'call-3',
};

describe('行动账本', () => {
  it('运行执行者的 Agent 由账本从运行记录查出；运行被删除后账本仍保留 Agent', () => {
    const db = createDb();
    db.exec(`ALTER TABLE workspace_nodes ADD COLUMN deleted_at INTEGER;
      CREATE TABLE runs (id TEXT PRIMARY KEY, agent_spec_id TEXT);
      INSERT INTO runs VALUES ('run-1', 'research_v1'), ('run-1-child', 'research_source_review_v1');`);
    const ledger = createSqliteActionLedger(db, { now: clock() });
    ledger.recorderFor(rootRun, 'coarse').record({ projectId: 'p1', documentId: 'doc-a', documentType: 'document', action: 'create' });
    ledger.recorderFor(childRun, 'coarse').record({ projectId: 'p1', documentId: 'doc-b', documentType: 'document', action: 'update' });
    ledger.recorderFor({ kind: 'user' }, 'coarse').record({ projectId: 'p1', documentId: 'doc-a', documentType: 'document', action: 'update' });
    db.exec('DELETE FROM runs');

    const changes = ledger.listDocumentChanges({ projectId: 'p1', limit: 10 });
    expect(changes.changes.map(change => [change.documentId, change.actorKind, change.agentId])).toEqual([
      ['doc-a', 'user', null],
      ['doc-b', 'subrun', 'research_source_review_v1'],
      ['doc-a', 'run', 'research_v1'],
    ]);
    const summary = ledger.summarizeProjectDocuments('p1').find(item => item.documentId === 'doc-a');
    expect(summary?.creator?.agentId).toBe('research_v1');
    expect(summary?.last.agentId).toBeNull();
  });

  it('没有运行表的装配里 Agent 记为空', () => {
    const ledger = createSqliteActionLedger(createDb(), { now: clock() });
    ledger.recorderFor(rootRun, 'coarse').record({ projectId: 'p1', documentId: 'doc-a', documentType: 'document', action: 'create' });
    expect(ledger.listDocumentChanges({ projectId: 'p1', limit: 10 }).changes[0]?.agentId).toBeNull();
  });

  it('同一执行者对同一文档的多次改动合成一项；按根运行查询包含各层子运行', () => {
    const ledger = createSqliteActionLedger(createDb(), { now: clock() });
    const root = ledger.recorderFor(rootRun, 'coarse');
    root.record({ projectId: 'p1', documentId: 'doc-a', documentType: 'document', action: 'create' });
    root.record({ projectId: 'p1', documentId: 'doc-a', documentType: 'document', action: 'update' });
    ledger.recorderFor(childRun, 'coarse').record({
      projectId: 'p1', documentId: 'doc-b', documentType: 'slides', action: 'update', afterRef: '7',
    });
    ledger.recorderFor(grandchildRun, 'coarse').record({
      projectId: 'p1', documentId: 'doc-a', documentType: 'document', action: 'update',
    });
    ledger.recorderFor({ ...rootRun, runId: 'run-2', rootRunId: 'run-2' }, 'coarse').record({
      projectId: 'p1', documentId: 'doc-b', documentType: 'slides', action: 'update',
    });

    const result = ledger.listDocumentChanges({ projectId: 'p1', rootRunId: 'run-1', limit: 10 });
    expect(result.truncated).toBe(false);
    expect(result.changes.map(change => [change.documentId, change.actorKind, change.runId, change.actions, change.entryCount]))
      .toEqual([
        ['doc-a', 'subrun', 'run-1-grandchild', ['update'], 1],
        ['doc-b', 'subrun', 'run-1-child', ['update'], 1],
        ['doc-a', 'run', 'run-1', ['create', 'update'], 2],
      ]);
    expect(result.changes[0]).toMatchObject({ rootRunId: 'run-1', parentRunId: 'run-1-child', conversationId: 'conv-1' });
    expect(result.changes[2]).toMatchObject({ firstRecordedAt: 1_010, lastRecordedAt: 1_020, granularity: 'coarse' });
  });

  it('按时间段查询只看本项目；超出上限明确标记截断', () => {
    const ledger = createSqliteActionLedger(createDb(), { now: clock() });
    const recorder = ledger.recorderFor(rootRun, 'coarse');
    recorder.record({ projectId: 'p1', documentId: 'doc-a', documentType: 'document', action: 'update' }); // 1010
    recorder.record({ projectId: 'p1', documentId: 'doc-b', documentType: 'document', action: 'update' }); // 1020
    recorder.record({ projectId: 'p2', documentId: 'doc-c', documentType: 'document', action: 'update' }); // 1030

    expect(ledger.listDocumentChanges({ projectId: 'p1', since: 1_015, until: 1_100, limit: 10 }).changes
      .map(change => change.documentId)).toEqual(['doc-b']);
    const limited = ledger.listDocumentChanges({ projectId: 'p1', limit: 1 });
    expect(limited).toMatchObject({ truncated: true, changes: [{ documentId: 'doc-b' }] });
    expect(() => ledger.listDocumentChanges({ projectId: 'p1', limit: 0 })).toThrow(RangeError);
    expect(() => ledger.listDocumentChanges({ projectId: 'p1', limit: 201 })).toThrow(RangeError);
  });

  it('同一调用已有 owner 细账时，Host 粗账不重复登记', () => {
    const ledger = createSqliteActionLedger(createDb(), { now: clock() });
    ledger.recorderFor(rootRun, 'fine').record({
      projectId: 'p1', documentId: 'doc-a', documentType: 'document', action: 'update', part: 'block-1', summary: { edits: 2 },
    });
    ledger.recorderFor(rootRun, 'coarse').record({ projectId: 'p1', documentId: 'doc-a', documentType: 'document', action: 'update' });
    ledger.recorderFor(rootRun, 'coarse').record({ projectId: 'p1', documentId: 'doc-b', documentType: 'document', action: 'update' });

    const changes = ledger.listDocumentChanges({ projectId: 'p1', limit: 10 }).changes;
    expect(changes.map(change => [change.documentId, change.granularity, change.entryCount])).toEqual([
      ['doc-b', 'coarse', 1],
      ['doc-a', 'fine', 1],
    ]);
  });

  it('文档或项目物理删除时账本随之删除；对话不是外键', () => {
    const db = createDb();
    const ledger = createSqliteActionLedger(db, { now: clock() });
    const recorder = ledger.recorderFor(rootRun, 'coarse');
    recorder.record({ projectId: 'p1', documentId: 'doc-a', documentType: 'document', action: 'update' });
    recorder.record({ projectId: 'p1', documentId: 'doc-b', documentType: 'document', action: 'update' });
    recorder.record({ projectId: 'p2', documentId: 'doc-c', documentType: 'document', action: 'update' });

    db.prepare("DELETE FROM workspace_nodes WHERE id = 'doc-a'").run();
    db.prepare("DELETE FROM projects WHERE id = 'p2'").run();
    expect(db.prepare('SELECT document_id FROM action_ledger_entries ORDER BY id').pluck().all()).toEqual(['doc-b']);
  });

  it('保留整个工具调用的细账；密集编辑按文档历史的时间桶精简', () => {
    const db = createDb();
    const ledger = createSqliteActionLedger(db, { now: clock() });
    for (let i = 0; i < 20; i++) {
      const recorder = ledger.recorderFor({ ...rootRun, toolCallId: String(i) }, 'fine');
      for (const part of ['a', 'b']) recorder.record({
        projectId: 'p1', documentId: 'doc-a', documentType: 'document', action: 'update', part,
      });
    }
    const calls = db.prepare('SELECT tool_call_id, COUNT(*) AS n FROM action_ledger_entries GROUP BY tool_call_id ORDER BY MIN(id)').all();
    expect(calls).toEqual([0, 15, 16, 17, 18, 19].map(i => ({ tool_call_id: String(i), n: 2 })));
  });

  it('数据库拒绝缺运行身份的运行记录，读取拒绝合同外的动作', () => {
    const db = createDb();
    expect(() => db.prepare(`
      INSERT INTO action_ledger_entries (recorded_at, project_id, document_id, document_type, action, granularity, actor_kind)
      VALUES (1, 'p1', 'doc-a', 'document', 'update', 'coarse', 'run')
    `).run()).toThrow(/CHECK/);
    db.prepare(`
      INSERT INTO action_ledger_entries (recorded_at, project_id, document_id, document_type, action, granularity, actor_kind)
      VALUES (1, 'p1', 'doc-a', 'document', 'rename', 'coarse', 'user')
    `).run();
    expect(() => createSqliteActionLedger(db).listDocumentChanges({ projectId: 'p1', limit: 10 }))
      .toThrow('不在合同范围内');
  });
});

describe('resolveToolRunActor', () => {
  it('根运行以自己为根；子运行带直接父运行和根运行', () => {
    expect(resolveToolRunActor({ runId: 'r', conversationId: 'c', parentToolCallId: 't' })).toEqual({
      kind: 'run', runId: 'r', rootRunId: 'r', parentRunId: null, conversationId: 'c', toolCallId: 't',
    });
    expect(resolveToolRunActor({ runId: 'g', parentRunId: 'child', rootRunId: 'r' })).toEqual({
      kind: 'subrun', runId: 'g', rootRunId: 'r', parentRunId: 'child', conversationId: null, toolCallId: null,
    });
  });

  it('没有运行编号不入账；身份自相矛盾时拒绝而不是猜', () => {
    expect(resolveToolRunActor({ conversationId: 'c' })).toBeUndefined();
    expect(() => resolveToolRunActor({ runId: 'child', parentRunId: 'r' })).toThrow('缺少根运行');
    expect(() => resolveToolRunActor({ runId: 'r', rootRunId: 'other' })).toThrow('没有父运行');
  });
});
