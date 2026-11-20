import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { canvasPluginMigrations } from '../../../persistence/migrations';
import { initializeCanvasDocument, readCanvasSnapshot, updateCanvasEditingClaim, type CanvasCommitActor } from '../../canvasCommit';
import { createCanvasHistoryRuntime } from '../../../orchestration/history/createCanvasHistoryRuntime';
import { readCanvasAgentGroups } from '..';
import { createCanvasPlainTextDocument } from '../../../../shared';

const text = (x: number) => ({ op: 'addText', content: createCanvasPlainTextDocument('Example'), x, y: 0, width: 240, height: 120 });
function fixture() {
  const database = new Database(':memory:'); database.pragma('foreign_keys = ON'); database.exec('CREATE TABLE workspace_nodes(id TEXT PRIMARY KEY)');
  for (const migration of canvasPluginMigrations) migration.up(database);
  database.prepare('INSERT INTO workspace_nodes VALUES (?)').run('doc'); initializeCanvasDocument(database, 'doc');
  const history = createCanvasHistoryRuntime({ database }); let next = 0;
  const user: CanvasCommitActor = { source: { kind: 'user', conversationId: null, runId: null }, viewId: 'view' };
  const agent: CanvasCommitActor = { source: { kind: 'agent', conversationId: 'A', runId: 'run' }, viewId: 'agent' };
  const commit = (operations: unknown[]) => history.commit({ request: { documentId: 'doc', requestId: `u${next++}`, operations }, actor: user, now: next });
  const apply = (operations: unknown[]) => history.commitAgent({ request: { documentId: 'doc', requestId: `a${next++}`, operations }, actor: agent, now: next });
  const withdraw = (groupId: string) => history.withdraw({ documentId: 'doc', groupId, requestId: `w${next++}`, viewId: 'view' }, next);
  const editing = (elementId: string, fields: readonly string[]) => updateCanvasEditingClaim(database, { documentId: 'doc', viewId: 'editor', elementId, fields, now: next });
  const group = () => {
    const [stored] = readCanvasAgentGroups(database, 'doc');
    if (!stored) throw new Error('missing group');
    return stored;
  };
  const element = (id: string) => readCanvasSnapshot(database, 'doc').elements.find(item => item.id === id);
  return { database, commit, apply, withdraw, editing, group, element };
}

describe('Canvas Agent group withdrawal retention', () => {
  it('keeps a change skipped because the user is editing it, so it can be withdrawn after editing ends', () => {
    const f = fixture(); f.commit([text(0)]);
    f.apply([{ op: 'update', id: 'c1', baseRevision: 1, patch: { color: 'yellow' } }]);
    f.editing('c1', ['color']);
    const skipped = f.withdraw(f.group().id);
    expect(skipped.commit.results[0]).toMatchObject({ status: 'skipped' });
    expect(f.element('c1')).toMatchObject({ color: 'yellow' });
    expect(f.group().entry.changes.map(change => [change.id, change.fields])).toEqual([['c1', ['color']]]);
    f.editing('c1', []);
    f.withdraw(f.group().id);
    expect(f.element('c1')).toMatchObject({ color: 'white' });
    expect(f.group().entry.changes).toEqual([]);
    f.database.close();
  });

  it('removes a change that was permanently preserved by a later write', () => {
    const f = fixture(); f.commit([text(0)]);
    f.apply([{ op: 'update', id: 'c1', baseRevision: 1, patch: { color: 'yellow' } }]);
    f.commit([{ op: 'update', id: 'c1', baseRevision: 2, patch: { color: 'green' } }]);
    f.withdraw(f.group().id);
    expect(f.element('c1')).toMatchObject({ color: 'green' });
    expect(f.group().entry.changes).toEqual([]);
    f.database.close();
  });

  it('keeps only the fields skipped for editing when the rest of a change was withdrawn', () => {
    const f = fixture(); f.commit([text(0)]);
    f.apply([{ op: 'update', id: 'c1', baseRevision: 1, patch: { color: 'yellow', locked: true } }]);
    f.editing('c1', ['locked']);
    f.withdraw(f.group().id);
    expect(f.element('c1')).toMatchObject({ color: 'white', locked: true });
    expect(f.group().entry.changes.map(change => [change.id, change.fields])).toEqual([['c1', ['locked']]]);
    f.editing('c1', []);
    f.withdraw(f.group().id);
    expect(f.element('c1')).toMatchObject({ color: 'white', locked: false });
    expect(f.group().entry.changes).toEqual([]);
    f.database.close();
  });

  it('clears only the deleted user cards that were actually restored', () => {
    const f = fixture();
    f.commit([{ ...text(0), ref: '$a' }, { ...text(2000), ref: '$b' }, { op: 'addSection', ref: '$s', title: '', width: 360, height: 240, members: ['$b'] }]);
    f.apply([{ op: 'delete', id: 'c1', baseRevision: 1 }, { op: 'delete', id: 'c2', baseRevision: 1 }]);
    expect([...f.group().deletedUserCardIds].sort()).toEqual(['c1', 'c2']);
    f.commit([{ op: 'delete', id: 'c3' }]);
    f.withdraw(f.group().id);
    expect(f.element('c1')).toBeDefined();
    expect(f.element('c2')).toBeUndefined();
    expect(f.group().deletedUserCardIds).toEqual(['c2']);
    f.database.close();
  });
});
