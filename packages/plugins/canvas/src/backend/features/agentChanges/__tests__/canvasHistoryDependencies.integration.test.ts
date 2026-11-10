import Database from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import { canvasPluginMigrations } from '../../../persistence/migrations';
import { initializeCanvasDocument, readCanvasSnapshot, updateCanvasEditingClaim, type CanvasCommitActor } from '../../canvasCommit';
import { createCanvasHistoryRuntime } from '../../../orchestration/history/createCanvasHistoryRuntime';
import { readCanvasAgentGroups, saveCanvasAgentGroup } from '..';
import { createCanvasPlainTextDocument } from '../../../../shared';
const user: CanvasCommitActor = { source: { kind: 'user', conversationId: null, runId: null }, viewId: 'user' };
const agent = (conversationId: string): CanvasCommitActor => ({ source: { kind: 'agent', conversationId, runId: conversationId }, viewId: conversationId });
const data = (value: string) => ({ contentVersion: 1, heightMode: 'auto', content: createCanvasPlainTextDocument(value) });
const databases: Database.Database[] = [];
function fixture() {
  const database = new Database(':memory:'); databases.push(database); database.pragma('foreign_keys = ON'); database.exec('CREATE TABLE workspace_nodes(id TEXT PRIMARY KEY)');
  for (const migration of canvasPluginMigrations) migration.up(database);
  database.prepare('INSERT INTO workspace_nodes VALUES (?)').run('doc'); initializeCanvasDocument(database, 'doc');
  const history = createCanvasHistoryRuntime({ database }); let next = 0;
  const write = (operations: readonly unknown[], actor = user) => history.commit({ request: { documentId: 'doc', requestId: `w${next++}`, operations }, actor, now: next });
  write([{ op: 'addText', width: 240, height: 120, content: createCanvasPlainTextDocument('原正文') }]);
  const withdraw = (conversationId: string) => {
    const group = history.listGroups('doc', 10).find(group => group.conversationId === conversationId); if (!group) throw new Error('missing group');
    return history.withdraw({ documentId: 'doc', viewId: 'user', groupId: group.id, requestId: `withdraw${next++}` }, next);
  };
  const undo = (direction: 'undo' | 'redo') => history.undo({ documentId: 'doc', viewId: 'user', requestId: `undo${next++}`, direction }, next);
  return { database, history, write, withdraw, undo, card: () => readCanvasSnapshot(database, 'doc').elements[0] };
}
const changeBody = [{ op: 'update', id: 'c1', baseRevision: 1, patch: { data: data('A的长正文'), height: 600, color: 'red' } }];
const resizeLater = [{ op: 'update', id: 'c1', baseRevision: 2, patch: { width: 120, height: 900 } }];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });
it('Agent组撤回保留后来宽高及其正文依赖，只撤独立颜色；undo/redo只反转实际子集', () => {
  const f = fixture(); f.write(changeBody, agent('A')); f.write(resizeLater, agent('B'));
  const result = f.withdraw('A');
  expect(result.commit.results[0]).toMatchObject({ status: 'applied', reason: 'dependent_field_changed' });
  expect(result.commit.results[0]?.fieldResults).toEqual(expect.arrayContaining([{ field: 'data', status: 'skipped', reason: 'dependent_field_changed' }, { field: 'height', status: 'skipped', reason: 'later_fields_preserved' }, { field: 'color', status: 'applied', reason: null }]));
  expect(f.card()).toMatchObject({ data: data('A的长正文'), width: 120, height: 900, color: 'white' });
  expect(f.history.listGroups('doc', 11).find(group => group.conversationId === 'B')?.updated).toEqual(['c1']);
  f.undo('undo'); expect(f.card()).toMatchObject({ data: data('A的长正文'), width: 120, height: 900, color: 'red' });
  f.undo('redo'); expect(f.card()).toMatchObject({ data: data('A的长正文'), width: 120, height: 900, color: 'white' });
});
it('用户Undo同样保留后来的Agent尺寸和正文，不因撤自己而拼接出旧正文加新高度', () => {
  const f = fixture(); f.write(changeBody); f.write(resizeLater, agent('B'));
  const result = f.undo('undo'); expect(result.commit.results[0]?.reason).toBe('dependent_field_changed');
  expect(f.card()).toMatchObject({ data: data('A的长正文'), width: 120, height: 900, color: 'white' });
  f.undo('redo'); expect(f.card()).toMatchObject({ data: data('A的长正文'), width: 120, height: 900, color: 'red' });
});
it('后来尺寸已被撤回而逻辑来源恢复时，可再撤原正文，不能把单调版本误当后写', () => {
  const f = fixture(); f.write(changeBody, agent('A')); f.write(resizeLater, agent('B'));
  f.withdraw('B'); expect(f.card()).toMatchObject({ data: data('A的长正文'), width: 240, height: 600 });
  f.withdraw('A'); expect(f.card()).toMatchObject({ data: data('原正文'), width: 240, height: 120, color: 'white' });
});
it('旧历史缺宽度来源事实时明确未知并保留自动正文，但可撤回独立颜色', () => {
  const f = fixture(); f.write(changeBody, agent('A'));
  const group = readCanvasAgentGroups(f.database, 'doc')[0]; if (!group) throw new Error('missing group');
  saveCanvasAgentGroup(f.database, { ...group, entry: { ...group.entry, changes: group.entry.changes.map(change => ({ ...change, afterOrigins: Object.fromEntries(Object.entries(change.afterOrigins).filter(([field]) => field !== 'width')) })) } });
  const result = f.withdraw('A'); expect(result.commit.results[0]?.reason).toBe('history_dependency_unknown');
  expect(result.commit.results[0]?.fieldResults?.filter(field => field.status === 'skipped').every(field => field.reason === 'history_dependency_unknown')).toBe(true);
  expect(f.card()).toMatchObject({ data: data('A的长正文'), width: 240, height: 600, color: 'white' });
});
it('别的视图只保护自动高度时，逆转也不能绕过它恢复旧正文', () => {
  const f = fixture(); f.write(changeBody, agent('A'));
  updateCanvasEditingClaim(f.database, { documentId: 'doc', viewId: 'other-view', elementId: 'c1', fields: ['height'], now: 2 });
  const result = f.withdraw('A'); expect(result.commit.results[0]?.reason).toBe('dependent_field_changed');
  expect(f.card()).toMatchObject({ data: data('A的长正文'), height: 600, color: 'white' });
});
