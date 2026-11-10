import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { canvasPluginMigrations } from '../../../persistence/migrations';
import { createEmptyCanvasDocument, readCanvasSnapshot, updateCanvasEditingClaim } from '../persistence/canvasRepository';
import { commitCanvasOperations } from '../orchestration/commitCanvasOperations';
import { createCanvasPlainTextDocument } from '../../../../shared';
import type { CanvasCommitActor } from '../definitions/canvasCommit';
import { Logger } from '@plugin/backend/workspaceRuntime';
import { createCanvasCliFailureProjector } from '../../../adapters/projectCanvasCliFailure';

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
  it('rejects deeply nested content as validation before recursive parsing and leaves no partial commit', () => {
    const database = fixture();
    try {
      let node: unknown = { type: 'paragraph', content: [] };
      for (let depth = 0; depth < 4096; depth++) node = { type: 'blockquote', content: [node] };
      let failure: unknown;
      try { commitCanvasOperations({ database, actor: agent, now: 1, request: { documentId: 'canvas', requestId: 'deep', operations: [
        add('不得半提交'), { ...add('深层正文'), content: { type: 'doc', content: [node] } },
      ] } }); } catch (error) { failure = error; }
      expect(createCanvasCliFailureProjector(new Logger('CanvasDepthTest'))(failure)).toMatchObject({ code: 'invalid_operations', issues: expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('128层') })]) });
      expect(readCanvasSnapshot(database, 'canvas').elements).toEqual([]);
      expect(database.prepare('SELECT count(*) AS n FROM canvas_requests').get()).toEqual({ n: 0 });
    } finally { database.close(); }
  });
  it.each([
    { operation: { op: 'connect', from: 'c1', to: 'c1' }, code: 'canvas_self_connection' },
    { operation: { op: 'connect', from: 'c1', to: 'c999' }, code: 'canvas_endpoint_missing' },
    { operation: { ...add('B'), near: 'c999' }, code: 'canvas_placement_target_missing' },
  ])('returns an actionable CLI failure and rolls back the whole invalid batch: $code', ({ operation, code }) => {
    const database = fixture();
    try {
      commitCanvasOperations({ database, actor: agent, now: 1, request: { documentId: 'canvas', requestId: 'seed', operations: [add('A')] } });
      const before = readCanvasSnapshot(database, 'canvas');
      const project = createCanvasCliFailureProjector(new Logger('CanvasCommitTest'));
      let failure: unknown;
      try { commitCanvasOperations({ database, actor: agent, now: 2, request: {
        documentId: 'canvas', requestId: 'invalid', operations: [add('不应半提交'), operation],
      } }); } catch (error) { failure = error; }
      expect(project(failure)).toMatchObject({ code });
      expect(readCanvasSnapshot(database, 'canvas')).toEqual(before);
      expect(database.prepare("SELECT COUNT(*) AS n FROM canvas_requests WHERE request_id = 'invalid'").get()).toEqual({ n: 0 });
    } finally { database.close(); }
  });
  it('skips an existing connection without discarding independent operations or consuming a new edge ID', () => {
    const database = fixture();
    try {
      const write = (requestId: string, operations: unknown[]) => commitCanvasOperations({ database, actor: agent, now: 1,
        request: { documentId: 'canvas', requestId, operations } });
      write('seed', [add('A'), add('B'), { op: 'connect', from: 'c1', to: 'c2' }]);
      const result = write('repeat-and-add', [{ op: 'connect', ref: '$existing', from: 'c1', to: 'c2', label: '不能覆盖原线' }, add('C')]);
      expect(result.results).toMatchObject([{ status: 'skipped', id: 'e1', reason: 'connection_exists' }, { status: 'applied', id: 'c3' }]);
      expect(result.refs.$existing).toBe('e1');
      expect(write('new-edge', [{ op: 'connect', from: 'c2', to: 'c3' }]).results[0].id).toBe('e2');
      expect(readCanvasSnapshot(database, 'canvas').elements.find(row => row.id === 'e1')).toMatchObject({ label: '' });
    } finally { database.close(); }
  });
  it('requires an Agent deletion baseline and preserves cards changed after that baseline', () => {
    const database = fixture();
    try {
      commitCanvasOperations({ database, actor: user, now: 1, request: { documentId: 'canvas', requestId: 'add', operations: [add('旧内容')] } });
      commitCanvasOperations({ database, actor: user, now: 2, request: { documentId: 'canvas', requestId: 'edit', operations: [{ op: 'update', id: 'c1', baseRevision: 1, patch: { color: 'green' } }] } });
      const remove = (requestId: string, baseRevision?: number) => commitCanvasOperations({ database, actor: agent, now: 3,
        request: { documentId: 'canvas', requestId, operations: [{ op: 'delete', id: 'c1', baseRevision }] } });
      expect(remove('no-baseline').results[0]).toMatchObject({ status: 'skipped', reason: 'revision_required' });
      expect(remove('stale', 1).results[0]).toMatchObject({ status: 'skipped', reason: 'stale_element' });
      expect(readCanvasSnapshot(database, 'canvas').elements[0]).toMatchObject({ revision: 2, color: 'green' });
      expect(remove('current', 2).results[0].status).toBe('applied');
    } finally { database.close(); }
  });
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

it('rechecks arrangement size dependencies and avoids obstacles created after worker calculation', () => {
  const database = fixture();
  const write = (requestId: string, operations: readonly unknown[], extras: object = {}) => commitCanvasOperations({ database, actor: user, now: 10, request: { documentId: 'canvas', requestId, operations, ...extras } });
  write('initial', [{ ...add('A'), x: 0, y: 0 }, { ...add('B'), x: 1000, y: 0 }]);
  write('new-obstacle', [{ ...add('用户新卡'), x: 500, y: 0 }]);
  const arranged = write('arrange', [{ op: 'update', id: 'c1', baseRevision: 1, patch: { x: 500, y: 0 } }], { layoutGroups: [['c1']] });
  expect(arranged.results[0]).toMatchObject({ status: 'applied', reason: 'placed_around_current_obstacle' });
  const moved = readCanvasSnapshot(database, 'canvas').elements.find(element => element.id === 'c1');
  expect(moved).not.toMatchObject({ x: 500, y: 0 });
  write('resize-B', [{ op: 'update', id: 'c2', baseRevision: 1, patch: { height: 500 } }]);
  expect(write('stale-layout', [{ op: 'update', id: 'c2', baseRevision: 1, patch: { x: 2000, y: 0 } }], { layoutGroups: [['c2']] }).results[0])
    .toMatchObject({ status: 'skipped', reason: 'stale_layout_size' });
  database.close();
});

it('binds computed new-card positions to local aliases despite another writer allocating the predicted ID', async () => {
  const { bindCanvasLayout } = await import('../../canvasWrite');
  const { CanvasElementIdSchema, CanvasLayoutResultSchema } = await import('../../../../shared');
  const database = fixture();
  const predictedId = CanvasElementIdSchema.parse('c1');
  const bound = bindCanvasLayout(CanvasLayoutResultSchema.pick({ operations: true }).parse({ operations: [{ op: 'update', id: 'c1', baseRevision: 1, patch: { x: 1000, y: 1000 } }] }), { $new: predictedId });
  commitCanvasOperations({ database, actor: user, now: 1, request: { documentId: 'canvas', requestId: 'other-writer', operations: [add('用户先分配')] } });
  const result = commitCanvasOperations({ database, actor: agent, now: 2, request: { documentId: 'canvas', requestId: 'late-layout', operations: [{ ...add('Agent新卡'), ref: '$new' }, ...bound.operations], layoutGroups: bound.layoutGroups } });
  expect(result.refs.$new).toBe('c2');
  const snapshot = readCanvasSnapshot(database, 'canvas');
  expect(snapshot.elements.find(element => element.id === 'c1')).toMatchObject({ x: 0, y: 0 });
  expect(snapshot.elements.find(element => element.id === 'c2')).toMatchObject({ x: 1000, y: 1000 });
  database.close();
});

it('does not relocate a locked newly created card through the arrangement obstacle pass', () => {
  const database = fixture();
  const result = commitCanvasOperations({ database, actor: user, now: 1, request: { documentId: 'canvas', requestId: 'locked-prefix',
    operations: [{ ...add('锁定新卡'), x: 0, y: 0, locked: true, ref: '$new' }, { ...add('覆盖占位'), x: 0, y: 0 }, { op: 'update', id: '$new', baseRevision: 1, patch: { x: 1000, y: 1000 } }], layoutGroups: [['$new']] } });
  expect(result.results[2]).toMatchObject({ status: 'skipped', reason: 'element_locked' });
  expect(readCanvasSnapshot(database, 'canvas').elements.find(element => element.id === 'c1')).toMatchObject({ x: 0, y: 0, locked: true });
  database.close();
});

it('quarantines unknown elements and dependent edges without touching raw rows or permitting lossy writes', async () => {
  const { readCanvasSynchronization } = await import('../index');
  const database = fixture();
  commitCanvasOperations({ database, actor: user, now: 1, request: { documentId: 'canvas', requestId: 'source', operations: [{ ...add('正常'), ref: '$a' }, { ...add('未来类型'), ref: '$b' }, { op: 'connect', from: '$a', to: '$b' }] } });
  const raw = JSON.stringify({ type: 'future-widget', schemaVersion: 2, id: 'c2', extensionPayload: { preserve: ['不能丢失'] } });
  database.prepare('UPDATE canvas_elements SET element_json = ? WHERE node_id = ? AND element_id = ?').run(raw, 'canvas', 'c2');
  const snapshot = readCanvasSnapshot(database, 'canvas');
  expect(snapshot.elements.map(element => element.id)).toEqual(['c1']);
  expect(snapshot.integrity?.readOnly).toBe(true);
  expect(snapshot.integrity?.issues.map(issue => issue.code)).toEqual(['unknown_element', 'dangling_edge']);
  expect(() => commitCanvasOperations({ database, actor: user, now: 2, request: { documentId: 'canvas', requestId: 'lossy-save', operations: [add('不能覆写')] } })).toThrow('只读');
  database.prepare('UPDATE canvas_changes SET changes_json = ? WHERE node_id = ?').run('not-json', 'canvas');
  expect(readCanvasSynchronization(database, { documentId: 'canvas', afterSequence: 0 })).toMatchObject({ kind: 'snapshot', snapshot: { integrity: { readOnly: true } } });
  expect(database.prepare('SELECT element_json FROM canvas_elements WHERE node_id = ? AND element_id = ?').get('canvas', 'c2')).toEqual({ element_json: raw });
  database.close();
});
it('opens newer document versions read-only and isolates damaged content while retaining supported cards', () => {
  const database = fixture();
  commitCanvasOperations({ database, actor: user, now: 1, request: { documentId: 'canvas', requestId: 'source', operations: [add('正常'), add('损坏')] } });
  database.prepare('UPDATE canvas_documents SET schema_version = 2 WHERE node_id = ?').run('canvas');
  expect(readCanvasSnapshot(database, 'canvas')).toMatchObject({ elements: [{ id: 'c1' }, { id: 'c2' }], integrity: { readOnly: true, formatVersion: 2 } });
  expect(() => commitCanvasOperations({ database, actor: agent, now: 2, request: { documentId: 'canvas', requestId: 'new-format-write', operations: [{ op: 'delete', id: 'c1' }] } })).toThrow('只读');
  database.prepare('UPDATE canvas_documents SET schema_version = 1 WHERE node_id = ?').run('canvas');
  database.prepare('UPDATE canvas_elements SET field_versions_json = ? WHERE element_id = ?').run('{broken', 'c2');
  const snapshot = readCanvasSnapshot(database, 'canvas');
  expect(snapshot.elements.map(element => element.id)).toEqual(['c1']); expect(snapshot.integrity?.issues[0]).toMatchObject({ elementId: 'c2', code: 'invalid_element' });
  database.close();
});

it('rejects unmanaged inline images atomically and quarantines legacy external sources before display', () => {
  const database = fixture();
  const external = { type: 'doc', content: [{ type: 'image', attrs: { src: 'https://example.test/image.png' } }] };
  expect(() => commitCanvasOperations({ database, actor: user, now: 1, request: { documentId: 'canvas', requestId: 'inline-image',
    operations: [add('不应半提交'), { ...add(''), content: external }] } })).toThrow('接管');
  expect(readCanvasSnapshot(database, 'canvas')).toMatchObject({ sequence: 0, elements: [] });
  commitCanvasOperations({ database, actor: user, now: 2, request: { documentId: 'canvas', requestId: 'inline-image', operations: [add('原文')] } });
  const card = readCanvasSnapshot(database, 'canvas').elements[0];
  if (card.type !== 'text') throw new Error('Expected text');
  const raw = JSON.stringify({ ...card, data: { ...card.data, content: external } });
  database.prepare('UPDATE canvas_elements SET element_json = ? WHERE node_id = ? AND element_id = ?').run(raw, 'canvas', 'c1');
  expect(readCanvasSnapshot(database, 'canvas')).toMatchObject({ elements: [], integrity: { readOnly: true, issues: [{ code: 'invalid_element' }] } });
  expect(database.prepare('SELECT element_json FROM canvas_elements WHERE node_id = ?').get('canvas')).toEqual({ element_json: raw });
  database.close();
});
