import Database from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import { canvasPluginMigrations } from '../../../persistence/migrations';
import { initializeCanvasDocument, readCanvasCommitState, readCanvasSnapshot, updateCanvasEditingClaim, type CanvasCommitActor } from '..';
import { createCanvasHistoryRuntime } from '../../../orchestration/history/createCanvasHistoryRuntime';
import { createCanvasPlainTextDocument } from '../../../../shared';
import { projectCanvasSkippedFieldWrites } from '../../agentChanges/functions/projectCanvasSkippedFieldWrites';
const user: CanvasCommitActor = { source: { kind: 'user', conversationId: null, runId: null }, viewId: 'user' };
const agent: CanvasCommitActor = { source: { kind: 'agent', conversationId: 'conversation', runId: 'run' }, viewId: 'agent' };
const text = (value: string) => ({ contentVersion: 1 as const, content: createCanvasPlainTextDocument(value), heightMode: 'auto' as const });
const databases: Database.Database[] = [];
function fixture() {
  const database = new Database(':memory:'); databases.push(database); database.pragma('foreign_keys = ON'); database.exec('CREATE TABLE workspace_nodes(id TEXT PRIMARY KEY)');
  for (const migration of canvasPluginMigrations) migration.up(database);
  database.prepare('INSERT INTO workspace_nodes VALUES (?)').run('doc'); initializeCanvasDocument(database, 'doc');
  const history = createCanvasHistoryRuntime({ database }); let next = 0;
  const write = (operations: readonly unknown[], actor = user, extras = {}) => history.commit({ request: { documentId: 'doc', requestId: `write${next++}`, operations, ...extras }, actor, now: next });
  const claim = (fields: string[]) => updateCanvasEditingClaim(database, { documentId: 'doc', viewId: 'user', elementId: 'c1', fields, now: 1 });
  return { database, history, write, claim, snapshot: () => readCanvasSnapshot(database, 'doc'), row: () => readCanvasCommitState(database, 'doc').elements.find(row => row.element.id === 'c1') };
}
const add = { op: 'addText', width: 240, height: 120, content: createCanvasPlainTextDocument('原始正文'), x: 0, y: 0 };
afterEach(() => { for (const database of databases.splice(0)) database.close(); });
it('同一operation的正文/自动高度被编辑保护时仍写颜色，持久组只记录实际字段并稳定重放', () => {
  const f = fixture(); f.write([add]); f.claim(['height']);
  const request = { documentId: 'doc', requestId: 'partial', operations: [{ op: 'update', id: 'c1', baseRevision: 1, patch: { data: text('不能盖掉用户草稿'), height: 900, color: 'red' } }] };
  const committed = f.history.commitAgent({ request, actor: agent, now: 2 });
  expect(committed).toMatchObject({ kind: 'committed', commit: { results: [{ status: 'applied', reason: 'partial_fields_skipped', fieldResults: expect.arrayContaining([{ field: 'data', status: 'skipped', reason: 'user_editing' }, { field: 'height', status: 'skipped', reason: 'user_editing' }, { field: 'color', status: 'applied', reason: null }]) }] } });
  expect(f.snapshot().elements[0]).toMatchObject({ data: text('原始正文'), height: 120, color: 'red', revision: 2 });
  expect(f.row()?.fieldVersions).toMatchObject({ data: 1, height: 1, color: 2 });
  expect(f.history.commitAgent({ request, actor: agent, now: 3 })).toEqual(committed);
  const group = f.history.listGroups('doc', 4)[0]; if (!group) throw new Error('missing group');
  expect(group.changes).toEqual([{ id: 'c1', kind: 'updated', fields: ['color'] }]);
  expect(group.outcomes.skippedWrites).toEqual([{ requestId: 'partial', index: 0, id: 'c1', reason: 'user_editing', fields: expect.arrayContaining(['data', 'height']) }]);
  f.history.withdraw({ documentId: 'doc', viewId: 'user', groupId: group.id, requestId: 'withdraw' }, 5);
  expect(f.snapshot().elements[0]).toMatchObject({ data: text('原始正文'), height: 120, color: 'white' });
});
it('同条过期正文/高度不落库，颜色按后写生效，不把正文冲突扩大到独立属性', () => {
  const f = fixture(); f.write([add]); f.write([{ op: 'update', id: 'c1', baseRevision: 1, patch: { data: text('用户新正文'), height: 200, color: 'green' } }]);
  const result = f.write([{ op: 'update', id: 'c1', baseRevision: 1, patch: { data: text('旧版正文'), height: 500, color: 'red' } }], agent);
  expect(result.results[0]).toMatchObject({ status: 'applied', reason: 'partial_fields_skipped', fieldResults: expect.arrayContaining([{ field: 'data', status: 'skipped', reason: 'stale_field' }, { field: 'height', status: 'skipped', reason: 'stale_field' }, { field: 'color', status: 'applied', reason: null }]) });
  expect(f.snapshot().elements[0]).toMatchObject({ data: text('用户新正文'), height: 200, color: 'red' });
});
it('自动测高组重验未写入的正文依赖，不能新宽度配旧正文高度；独立颜色照常成功', () => {
  const f = fixture(); f.write([add]); f.write([{ op: 'update', id: 'c1', baseRevision: 1, patch: { data: text('提交前刚更新的长正文') } }]);
  const result = f.write([{ op: 'update', id: 'c1', baseRevision: 1, patch: { width: 100, height: 800, color: 'purple' } }], agent);
  expect(result.results[0]).toMatchObject({ status: 'applied', fieldResults: expect.arrayContaining([{ field: 'width', status: 'skipped', reason: 'stale_measurement' }, { field: 'height', status: 'skipped', reason: 'stale_measurement' }, { field: 'color', status: 'applied', reason: null }]) });
  expect(f.snapshot().elements[0]).toMatchObject({ width: 240, height: 120, color: 'purple' });
});
it('XY保护或布局尺寸过期时color成功也不触发清障绕过保护，哪怕原位置与用户卡重叠', () => {
  const f = fixture(); f.write([add, { ...add, x: 500 }]);
  f.write([{ op: 'update', id: 'c2', baseRevision: 1, patch: { x: 0, y: 0 } }]); f.claim(['x']);
  const request = [{ op: 'update', id: 'c1', baseRevision: 1, patch: { x: 1000, y: 500, color: 'red' } }];
  const result = f.write(request, agent, { layoutGroups: [['c1']] });
  expect(result.results[0]).toMatchObject({ status: 'applied', fieldResults: expect.arrayContaining([{ field: 'x', status: 'skipped', reason: 'user_editing' }, { field: 'y', status: 'skipped', reason: 'user_editing' }, { field: 'color', status: 'applied', reason: null }]) });
  expect(f.snapshot().elements.find(card => card.id === 'c1')).toMatchObject({ x: 0, y: 0, color: 'red' });
  f.claim([]); f.write([{ op: 'update', id: 'c1', baseRevision: 2, patch: { height: 220 } }]);
  const stale = f.write([{ op: 'update', id: 'c1', baseRevision: 2, patch: { x: 1000, y: 500, color: 'green' } }], agent, { layoutGroups: [['c1']] });
  expect(stale.results[0]?.fieldResults?.filter(field => field.status === 'skipped').map(field => field.reason)).toEqual(['stale_layout_size', 'stale_layout_size']);
  expect(f.snapshot().elements.find(card => card.id === 'c1')).toMatchObject({ x: 0, y: 0, height: 220, color: 'green' });
});
it('图片裁剪/资产与本次frame是一个语义组，不能只套几何导致图像错位，颜色仍独立', () => {
  const f = fixture(); f.write([{ op: 'addImage', x: 0, y: 0, width: 240, height: 120, data: { assetId: 'asset', caption: '', alt: '', crop: null } }]); f.claim(['data']);
  const result = f.write([{ op: 'update', id: 'c1', baseRevision: 1, patch: { data: { assetId: 'asset', caption: '', alt: '', crop: { x: 0.2, y: 0, width: 0.5, height: 1 } }, x: 20, y: 0, width: 120, height: 120, color: 'cyan' } }], agent);
  expect(result.results[0]?.fieldResults?.filter(field => field.status === 'applied').map(field => field.field)).toEqual(['color']);
  expect(f.snapshot().elements[0]).toMatchObject({ data: { crop: null }, x: 0, y: 0, width: 240, height: 120, color: 'cyan' });
});
it('部分冲突不能把非法正文洗成成功；格式错误仍整批回滚，包括前面的合法颜色', () => {
  const f = fixture(); f.write([add]); f.claim(['data']);
  expect(() => f.write([{ op: 'update', id: 'c1', baseRevision: 1, patch: { color: 'red' } }, { op: 'update', id: 'c1', baseRevision: 1, patch: { data: { contentVersion: 1, content: { type: 'doc', content: [{ type: 'text', text: '非法根正文' }] } }, color: 'green' } }], agent)).toThrow();
  expect(f.snapshot()).toMatchObject({ sequence: 1, elements: [{ color: 'white', revision: 1 }] });
});
it('旧回执缺字段事实明确未知，不能由原patch或当前卡猜测跳过字段', () => {
  expect(projectCanvasSkippedFieldWrites({ documentId: 'doc', requestId: 'old', sequence: 1, refs: {}, results: [{ index: 0, id: null, status: 'skipped', reason: 'user_editing' }] })).toEqual({ complete: false, skippedWrites: [{ requestId: 'old', index: 0, id: null, reason: 'user_editing', fields: null }] });
});
it('线样式按后写生效但标签保持读版本保护，不能用样式覆盖携带旧标签', () => {
  const f = fixture(); f.write([add, { ...add, x: 500 }, { op: 'connect', from: 'c1', to: 'c2', label: '初始标签' }]);
  f.write([{ op: 'update', id: 'e1', baseRevision: 1, patch: { label: '用户新标签', direction: 'both', lineStyle: 'straight' } }]);
  const result = f.write([{ op: 'update', id: 'e1', baseRevision: 1, patch: { label: '旧代理标签', direction: 'forward', lineStyle: 'curve', linePattern: 'dashed' } }], agent);
  expect(result.results[0]).toMatchObject({ status: 'applied', reason: 'partial_fields_skipped' });
  expect(result.results[0]?.fieldResults?.filter(field => field.status === 'skipped')).toEqual([{ field: 'label', status: 'skipped', reason: 'stale_field' }]);
  expect(f.snapshot().elements.find(element => element.id === 'e1')).toMatchObject({ label: '用户新标签', direction: 'forward', lineStyle: 'curve', linePattern: 'dashed' });
});
