import Database from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';

import { ACTION_LEDGER_SCHEMAS } from '../../action-ledger/infrastructure/sqlite/actionLedger.schema';
import { SEMANTIC_LAYER_SCHEMAS } from '../infrastructure/sqlite/semanticLayer.schema';
import { createSqliteSemanticLayer } from '../infrastructure/sqlite/createSqliteSemanticLayer';
import {
  listSemanticTagNames,
  readSemanticTagNames,
  resolveSemanticTagNames,
} from '../infrastructure/sqlite/semanticTagProjection';

const databases: Database.Database[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function setup() {
  const db = new Database(':memory:');
  databases.push(db);
  db.exec('CREATE TABLE workspace_nodes (id TEXT PRIMARY KEY); CREATE TABLE conversations (conversation_id TEXT PRIMARY KEY);');
  for (const statement of [...ACTION_LEDGER_SCHEMAS, ...SEMANTIC_LAYER_SCHEMAS]) db.exec(statement);
  let time = 1_000;
  let id = 0;
  const layer = createSqliteSemanticLayer(db, { read: () => null }, { now: () => (time += 10), newId: () => `id-${++id}` });
  return { db, layer };
}

it('插件按 ID 读标签：改名随当前名称，合并后跟到目标（含连续合并），删除后不再返回，撤回合并又回到原标签', () => {
  const { db, layer } = setup();
  const pending = layer.defineTag({ name: '待查' });
  const doubt = layer.defineTag({ name: '存疑' });
  const evidence = layer.defineTag({ name: '证据' });
  const unsure = layer.defineTag({ name: '不确定', allowSimilar: true });
  layer.renameTag(pending.id, '待核实');
  expect(readSemanticTagNames(db, [pending.id]).get(pending.id)).toEqual({ id: pending.id, name: '待核实' });

  const merged = layer.mergeTags(doubt.id, unsure.id);
  layer.mergeTags(unsure.id, pending.id);
  expect(readSemanticTagNames(db, [doubt.id, unsure.id]).get(doubt.id)).toEqual({ id: pending.id, name: '待核实' });
  layer.deleteTag(evidence.id);
  expect(readSemanticTagNames(db, [evidence.id, 'missing']).size).toBe(0);
  expect(listSemanticTagNames(db).map(tag => tag.name)).toEqual(['待核实']);

  layer.undoChange(merged.id);
  expect(readSemanticTagNames(db, [doubt.id]).get(doubt.id)).toEqual({ id: doubt.id, name: '存疑' });
});

it('按名称或 ID 解析现有标签，名称按语义层规则归一化；找不到的给出相近名称，不新建', () => {
  const { db, layer } = setup();
  const paper = layer.defineTag({ name: 'Paper' });
  const result = resolveSemanticTagNames(db, ['ＰＡＰＥＲ', paper.id, 'papers', '#非法']);
  expect(result.found.get('ＰＡＰＥＲ')).toEqual({ id: paper.id, name: 'Paper' });
  expect(result.found.get(paper.id)?.name).toBe('Paper');
  expect(result.missing).toEqual([
    { name: 'papers', similar: ['Paper'] },
    { name: '#非法', similar: [] },
  ]);
  expect(listSemanticTagNames(db)).toHaveLength(1);
});
