import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { canvasPluginMigrations } from '../../../persistence/migrations';
import { createEmptyCanvasDocument, readCanvasSnapshot, updateCanvasEditingClaim } from '../persistence/canvasRepository';
import { commitCanvasOperations } from '../orchestration/commitCanvasOperations';
import { createCanvasPlainTextDocument } from '../../../../shared';
import type { CanvasCommitActor } from '../definitions/canvasCommit';

const user: CanvasCommitActor = { source: { kind: 'user', conversationId: null, runId: null }, viewId: 'view' };
const agent: CanvasCommitActor = { source: { kind: 'agent', conversationId: 'conversation', runId: 'run' }, viewId: 'agent' };
const add = (text: string) => ({ op: 'addText', content: createCanvasPlainTextDocument(text), width: 240, height: 120 });

function fixture() {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  database.exec('CREATE TABLE workspace_nodes (id TEXT PRIMARY KEY)');
  for (const migration of canvasPluginMigrations) migration.up(database);
  database.prepare('INSERT INTO workspace_nodes VALUES (?)').run('canvas');
  createEmptyCanvasDocument(database, 'canvas');
  return database;
}

describe('Canvas atomic editing', () => {
  it('creates, edits and reopens through the same persisted model', () => {
    const database = fixture();
    const first = commitCanvasOperations({ database, request: { documentId: 'canvas', requestId: 'one', operations: [add('第一张'), add('第二张')] }, actor: user, now: 1 });
    expect(first.sequence).toBe(1);
    expect(readCanvasSnapshot(database, 'canvas').elements).toHaveLength(2);
    commitCanvasOperations({ database, request: { documentId: 'canvas', requestId: 'edit', operations: [{ op: 'update', id: 'c1', baseRevision: 1, patch: { color: 'yellow' } }] }, actor: user, now: 2 });
    const reopened = readCanvasSnapshot(database, 'canvas');
    expect(reopened.sequence).toBe(2);
    expect(reopened.elements.find(row => row.id === 'c1')).toMatchObject({ revision: 2, color: 'yellow' });
    database.close();
  });

  it('replays a receipt once, rejects changed payload, permits intentional identical additions', () => {
    const database = fixture();
    const request = { documentId: 'canvas', requestId: 'same', operations: [add('重复正文')] };
    const input = { database, request, actor: agent, now: 1 };
    const first = commitCanvasOperations(input);
    expect(commitCanvasOperations(input)).toEqual(first);
    expect(() => commitCanvasOperations({ ...input, request: { ...request, operations: [add('换载荷')] } })).toThrow('request_id_payload_mismatch');
    commitCanvasOperations({ ...input, request: { ...request, requestId: 'another' } });
    expect(readCanvasSnapshot(database, 'canvas').elements).toHaveLength(2);
    database.close();
  });

  it('rolls back content, sequence, allocation and receipt when a transaction participant fails', () => {
    const database = fixture();
    const input = { database, request: { documentId: 'canvas', requestId: 'retry', operations: [add('待提交')] }, actor: user, now: 1 };
    expect(() => commitCanvasOperations({ ...input, ports: { participants: [{ commit() { throw new Error('reference conflict'); } }] } })).toThrow('reference conflict');
    expect(readCanvasSnapshot(database, 'canvas')).toMatchObject({ sequence: 0, elements: [] });
    expect(commitCanvasOperations(input).results[0]?.id).toBe('c1');
    database.close();
  });

  it('protects an actively edited field and deletion while letting independent writes proceed', () => {
    const database = fixture();
    commitCanvasOperations({ database, request: { documentId: 'canvas', requestId: 'add', operations: [add('草稿基线')] }, actor: user, now: 1 });
    updateCanvasEditingClaim(database, { documentId: 'canvas', viewId: user.viewId, elementId: 'c1', fields: ['data'], now: 2 });
    const result = commitCanvasOperations({ database, actor: agent, now: 3, request: { documentId: 'canvas', requestId: 'conflict', operations: [
      { op: 'update', id: 'c1', baseRevision: 1, patch: { data: { contentVersion: 1, content: createCanvasPlainTextDocument('覆盖') } } },
      { op: 'update', id: 'c1', baseRevision: 1, patch: { color: 'green' } },
      { op: 'delete', id: 'c1' },
    ] } });
    expect(result.results.map(row => row.status)).toEqual(['skipped', 'applied', 'skipped']);
    expect(readCanvasSnapshot(database, 'canvas').elements[0]).toMatchObject({ color: 'green', data: { content: createCanvasPlainTextDocument('草稿基线') } });
    database.close();
  });

  it('keeps committed content when notification fails and cascades physical document deletion', () => {
    const database = fixture();
    let failed = false;
    commitCanvasOperations({ database, request: { documentId: 'canvas', requestId: 'create', operations: [add('已保存')] }, actor: user, now: 1,
      ports: { publish() { throw new Error('subscriber stopped'); }, publicationFailed() { failed = true; } } });
    expect(failed).toBe(true);
    expect(readCanvasSnapshot(database, 'canvas').elements).toHaveLength(1);
    database.prepare('DELETE FROM workspace_nodes WHERE id = ?').run('canvas');
    expect(database.prepare('SELECT count(*) AS count FROM canvas_elements').get()).toEqual({ count: 0 });
    database.close();
  });
});
