import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { SEMANTIC_LAYER_SCHEMAS } from '../../../infrastructure/sqlite/semanticLayer.schema';
import { createSqliteSemanticLayer } from '../../../infrastructure/sqlite/createSqliteSemanticLayer';
import { ACTION_LEDGER_SCHEMAS } from '../../../../action-ledger/infrastructure/sqlite/actionLedger.schema';
import { SemanticLayerError } from '../../../definitions/semanticLayer';
import { compileSemanticQuery } from '../functions/compileSemanticQuery';
import { registerSemanticFold, runSemanticQuery } from '../orchestration/runSemanticQuery';
import type { SemanticQuery } from '../definitions/semanticQuery';

const databases: Database.Database[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function setup() {
  const db = new Database(':memory:');
  databases.push(db);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE workspace_nodes (
      id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      type TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
    );
    CREATE INDEX idx_workspace_nodes_project ON workspace_nodes(project_id, deleted_at);
    CREATE TABLE conversations (conversation_id TEXT PRIMARY KEY);
    INSERT INTO projects VALUES ('p1'), ('p2');
  `);
  for (const statement of [...ACTION_LEDGER_SCHEMAS, ...SEMANTIC_LAYER_SCHEMAS]) db.exec(statement);
  const insert = db.prepare('INSERT INTO workspace_nodes VALUES (?, ?, ?, ?, ?, ?, NULL)');
  [
    ['a', 'p1', 'document', 'Alpha 笔记', 1, 50],
    ['b', 'p1', 'document', 'Beta', 2, 40],
    ['c', 'p1', 'slides', 'Ｇａｍｍａ 演示', 3, 30],
    ['d', 'p1', 'document', 'Delta', 4, 20],
    ['x', 'p2', 'document', 'Other project', 5, 10],
  ].forEach(row => insert.run(...row));
  const documents = {
    read: (id: string) => {
      const row = db.prepare('SELECT project_id, type, deleted_at FROM workspace_nodes WHERE id = ?').get(id) as
        { project_id: string; type: string; deleted_at: number | null } | undefined;
      return row ? { projectId: row.project_id, nodeType: row.type, deletedAt: row.deleted_at } : null;
    },
  };
  let id = 0;
  const layer = createSqliteSemanticLayer(db, documents, { newId: () => `id${++id}` });
  layer.defineProperty({ name: '作者', valueType: 'text' });
  layer.defineProperty({ name: '年份', valueType: 'number' });
  layer.defineProperty({ name: '状态', valueType: 'select', options: ['待读', '在读', '读完'] });
  layer.defineProperty({ name: '主题', valueType: 'multi_select', options: ['AI', '数据', '设计'] });
  layer.defineProperty({ name: '已读', valueType: 'checkbox' });
  layer.defineProperty({ name: '截止', valueType: 'date' });
  layer.defineProperty({ name: '开会', valueType: 'datetime' });
  layer.defineTag({ name: '论文', fields: ['作者', '年份', '状态', '主题', '已读', '截止', '开会'].map(propertyId => ({ propertyId })) });
  layer.defineTag({ name: '收藏' });
  const write = (docId: string, tags: string[], values: Record<string, unknown>) => {
    let state = layer.readObject('p1', { kind: 'document', id: docId });
    state = layer.tagObject({ projectId: 'p1', ref: state.ref, expectedRevision: state.revision }, tags);
    if (Object.keys(values).length) layer.setValues({ projectId: 'p1', ref: state.ref, expectedRevision: state.revision }, values);
  };
  write('a', ['论文', '收藏'], { 作者: 'Ada Lovelace', 年份: 2021, 状态: '读完', 主题: ['AI', '数据'], 已读: true, 截止: '2026-11-01', 开会: '2026-11-10T09:00:00+08:00' });
  write('b', ['论文'], { 作者: 'ada', 年份: 2019, 状态: '待读', 主题: ['设计'], 已读: false, 开会: '2026-11-10T02:00:00Z' });
  write('c', ['论文'], { 年份: 2023, 状态: '在读' });
  write('d', ['收藏'], {});
  return { db, layer, definitions: { tags: layer.listTags(), properties: layer.listProperties() } };
}

function ids(result: { rows: readonly { documentId: string }[] }) {
  return result.rows.map(row => row.documentId);
}

describe('查询描述的语义', () => {
  const base = (query: Partial<SemanticQuery>): SemanticQuery => ({ projectId: 'p1', limit: 50, ...query });

  it('范围是一个项目；标签条件要求同时带有', () => {
    const { db, definitions } = setup();
    expect(ids(runSemanticQuery(db, base({}), definitions)).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(runSemanticQuery(db, base({ tags: ['论文', '收藏'] }), definitions))).toEqual(['a']);
  });

  it('文字比较不分大小写，含全角；“不等于”包含未设置', () => {
    const { db, definitions } = setup();
    expect(ids(runSemanticQuery(db, base({ where: [{ field: '作者', op: 'eq', value: 'ADA' }] }), definitions))).toEqual(['b']);
    expect(ids(runSemanticQuery(db, base({ where: [{ field: '作者', op: 'contains', value: 'ada' }], sort: [{ field: 'name', direction: 'asc' }] }), definitions))).toEqual(['a', 'b']);
    expect(ids(runSemanticQuery(db, base({ where: [{ field: 'name', op: 'contains', value: 'gamma' }] }), definitions))).toEqual(['c']);
    expect(ids(runSemanticQuery(db, base({ tags: ['论文'], where: [{ field: '作者', op: 'neq', value: 'ada' }], sort: [{ field: 'name', direction: 'asc' }] }), definitions))).toEqual(['a', 'c']);
  });

  it('为空只匹配带这个字段的对象：没带标签的文档不算“空”', () => {
    const { db, definitions } = setup();
    expect(ids(runSemanticQuery(db, base({ where: [{ field: '作者', op: 'empty' }] }), definitions))).toEqual(['c']);
  });

  it('勾选：未勾选同时包含 false 与未设置', () => {
    const { db, definitions } = setup();
    expect(ids(runSemanticQuery(db, base({ where: [{ field: '已读', op: 'eq', value: false }], sort: [{ field: 'name', direction: 'asc' }] }), definitions))).toEqual(['b', 'c']);
    expect(ids(runSemanticQuery(db, base({ where: [{ field: '已读', op: 'eq', value: true }] }), definitions))).toEqual(['a']);
  });

  it('多选“包含”命中任一选项，“不包含”要求一个都没有', () => {
    const { db, definitions } = setup();
    expect(ids(runSemanticQuery(db, base({ where: [{ field: '主题', op: 'contains', value: ['数据', '设计'] }], sort: [{ field: 'name', direction: 'asc' }] }), definitions))).toEqual(['a', 'b']);
    expect(ids(runSemanticQuery(db, base({ where: [{ field: '主题', op: 'not_contains', value: 'AI' }], sort: [{ field: 'name', direction: 'asc' }] }), definitions))).toEqual(['b', 'c']);
  });

  it('日期按日历日比较；日期时间按绝对时刻比较，不按字符串', () => {
    const { db, definitions } = setup();
    expect(ids(runSemanticQuery(db, base({ where: [{ field: '截止', op: 'lt', value: '2026-11-02' }] }), definitions))).toEqual(['a']);
    // 09:00+08:00 = 01:00Z，早于 02:00Z；按字符串比较会得到相反结果。
    expect(ids(runSemanticQuery(db, base({ where: [{ field: '开会', op: 'lt', value: '2026-11-10T01:30:00Z' }] }), definitions))).toEqual(['a']);
  });

  it('排序：数字按数值，单选按选项顺序，没有值的排最后', () => {
    const { db, definitions } = setup();
    expect(ids(runSemanticQuery(db, base({ tags: ['论文'], sort: [{ field: '年份', direction: 'desc' }] }), definitions))).toEqual(['c', 'a', 'b']);
    expect(ids(runSemanticQuery(db, base({ sort: [{ field: '状态', direction: 'asc' }] }), definitions))).toEqual(['b', 'c', 'a', 'd']);
  });

  it('分组计数；多选的对象出现在每个选项组', () => {
    const { db, definitions, layer } = setup();
    const status = layer.listProperties().find(property => property.name === '主题');
    const result = runSemanticQuery(db, base({ tags: ['论文'], groupBy: '主题' }), definitions);
    const byName = Object.fromEntries((result.groups ?? []).map(group => [
      group.key === null ? '无' : status?.options.find(option => option.id === group.key)?.name, group.count,
    ]));
    expect(byName).toEqual({ AI: 1, 数据: 1, 设计: 1, 无: 1 });
    expect(runSemanticQuery(db, base({ groupBy: '已读', tags: ['论文'] }), definitions).groups).toEqual([
      { key: false, count: 2 }, { key: true, count: 1 },
    ]);
  });

  it('结果有上限，截断时 truncated 为真并给出总数', () => {
    const { db, definitions } = setup();
    const result = runSemanticQuery(db, base({ limit: 2 }), definitions);
    expect(result).toMatchObject({ total: 4, truncated: true });
    expect(result.rows).toHaveLength(2);
  });

  it('去掉标签后保留的旧值不参与筛选，也不出现在结果里', () => {
    const { db, layer } = setup();
    const state = layer.readObject('p1', { kind: 'document', id: 'b' });
    layer.untagObject({ projectId: 'p1', ref: state.ref, expectedRevision: state.revision }, ['论文']);
    const definitions = { tags: layer.listTags(), properties: layer.listProperties() };
    expect(ids(runSemanticQuery(db, base({ where: [{ field: '作者', op: 'eq', value: 'ada' }] }), definitions))).toEqual([]);
    expect(runSemanticQuery(db, base({ where: [{ field: 'name', op: 'eq', value: 'beta' }] }), definitions).rows[0]?.values).toEqual({});
  });

  it('字段名写错时报错并列出可用字段；条件与类型不符时报错', () => {
    const { definitions } = setup();
    try {
      compileSemanticQuery(base({ where: [{ field: '作着', op: 'eq', value: 'x' }] }), definitions);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SemanticLayerError);
      expect(error).toMatchObject({ code: 'unknown_property', details: { available: expect.arrayContaining(['作者', 'name', 'updated']) } });
    }
    expect(() => compileSemanticQuery(base({ where: [{ field: '年份', op: 'contains', value: 1 }] }), definitions)).toThrow(SemanticLayerError);
    expect(() => compileSemanticQuery(base({ where: [{ field: '状态', op: 'eq', value: '读了' }] }), definitions)).toThrow(SemanticLayerError);
    expect(() => compileSemanticQuery(base({ limit: 201 }), definitions)).toThrow(SemanticLayerError);
  });
});

describe('编译器与索引', () => {
  it('按项目索引读节点，标签与字段条件走主键，不全表扫描', () => {
    const { db, definitions } = setup();
    registerSemanticFold(db);
    const compiled = compileSemanticQuery({
      projectId: 'p1', tags: ['论文'], where: [{ field: '年份', op: 'gte', value: 2020 }], limit: 50,
    }, definitions);
    const plan = (db.prepare(`EXPLAIN QUERY PLAN SELECT node.id ${compiled.from}`).all(...compiled.params) as { detail: string }[])
      .map(row => row.detail);
    expect(plan.some(detail => /SEARCH node USING INDEX idx_workspace_nodes_project/.test(detail))).toBe(true);
    expect(plan.filter(detail => /^SCAN (node|value|tagged|available_tag|semantic_)/.test(detail))).toEqual([]);
  });
});
