import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { createSqliteActionLedger, withActionActor, type ActionRunActor } from '../../action-ledger';
import { ACTION_LEDGER_SCHEMAS } from '../../action-ledger/infrastructure/sqlite/actionLedger.schema';
import { SEMANTIC_LAYER_SCHEMAS } from '../infrastructure/sqlite/semanticLayer.schema';
import { createSqliteSemanticLayer } from '../infrastructure/sqlite/createSqliteSemanticLayer';
import { SemanticLayerError, type SemanticDocumentPort } from '../definitions/semanticLayer';

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
      type TEXT NOT NULL, deleted_at INTEGER
    );
    CREATE TABLE conversations (conversation_id TEXT PRIMARY KEY);
    INSERT INTO projects VALUES ('p1'), ('p2');
    INSERT INTO workspace_nodes VALUES
      ('doc-a', 'p1', 'document', NULL), ('doc-b', 'p1', 'slides', NULL),
      ('doc-other', 'p2', 'document', NULL), ('folder', 'p1', 'folder', NULL), ('trashed', 'p1', 'document', 5);
  `);
  for (const statement of [...ACTION_LEDGER_SCHEMAS, ...SEMANTIC_LAYER_SCHEMAS]) db.exec(statement);
  const documents: SemanticDocumentPort = {
    read: id => {
      const row = db.prepare('SELECT project_id, type, deleted_at FROM workspace_nodes WHERE id = ?')
        .get(id) as { project_id: string | null; type: string; deleted_at: number | null } | undefined;
      return row ? { projectId: row.project_id, nodeType: row.type, deletedAt: row.deleted_at } : null;
    },
  };
  let time = 1_000;
  let id = 0;
  const layer = createSqliteSemanticLayer(db, documents, { now: () => (time += 10), newId: () => `id-${++id}` });
  return { db, layer };
}

function codeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    if (error instanceof SemanticLayerError) return error.code;
    throw error;
  }
  return undefined;
}

const docA = { kind: 'document', id: 'doc-a' } as const;
const run: ActionRunActor = {
  kind: 'run', runId: 'run-1', rootRunId: 'run-1', parentRunId: null, conversationId: 'conv-1', toolCallId: 'call-1',
};

describe('标签与字段定义', () => {
  it('名称先 NFKC 再大小写折叠后唯一；全角、大小写不同也算重名', () => {
    const { layer } = setup();
    layer.defineTag({ name: 'Paper' });
    expect(codeOf(() => layer.defineTag({ name: 'ＰＡＰＥＲ' }))).toBe('name_conflict');
    expect(codeOf(() => layer.defineTag({ name: '  paper ' }))).toBe('name_conflict');
    expect(codeOf(() => layer.defineTag({ name: '#论文' }))).toBe('invalid_name');
  });

  it('新建前提示相近名称，确认后才允许新建', () => {
    const { layer } = setup();
    layer.defineTag({ name: 'todo' });
    layer.defineTag({ name: '论文' });
    for (const name of ['to-do', 'To Do', 'todos', '论文集']) {
      expect(codeOf(() => layer.defineTag({ name })), name).toBe('similar_name');
    }
    expect(layer.findSimilar('tag', 'to do').map(tag => tag.name)).toEqual(['todo']);
    expect(layer.defineTag({ name: 'todos', allowSimilar: true }).name).toBe('todos');
    expect(codeOf(() => layer.defineTag({ name: '会议' }))).toBeUndefined();
  });

  it('字段带类型与选项；带点的名称留给插件', () => {
    const { layer } = setup();
    const status = layer.defineProperty({ name: '状态', valueType: 'select', options: ['未读', '已读'] });
    expect(status.options.map(option => option.name)).toEqual(['未读', '已读']);
    expect(codeOf(() => layer.defineProperty({ name: 'slides.pageCount', valueType: 'number' }))).toBe('reserved_name');
    expect(codeOf(() => layer.defineProperty({ name: '分类', valueType: 'select' }))).toBe('invalid_definition');
    expect(codeOf(() => layer.defineProperty({ name: '页数', valueType: 'number', options: ['1'] }))).toBe('invalid_definition');
  });
});

describe('对象的标签与值', () => {
  function paperSetup() {
    const context = setup();
    const { layer } = context;
    layer.defineProperty({ name: '作者', valueType: 'text' });
    layer.defineProperty({ name: '年份', valueType: 'number' });
    layer.defineProperty({ name: '已读', valueType: 'checkbox' });
    layer.defineProperty({ name: '截止', valueType: 'date' });
    layer.defineTag({ name: '论文', fields: [{ propertyId: '作者' }, { propertyId: '年份' }, { propertyId: '已读', defaultValue: false }] });
    layer.defineTag({ name: '任务', fields: [{ propertyId: '截止' }, { propertyId: '已读' }] });
    return context;
  }

  it('字段是全部标签字段的并集；默认值只在打标签时写一次', () => {
    const { layer } = paperSetup();
    let state = layer.tagObject({ projectId: 'p1', ref: docA, expectedRevision: 0 }, ['论文']);
    expect(state.revision).toBe(1);
    expect(state.fields.map(field => field.property.name)).toEqual(['作者', '年份', '已读']);
    expect(Object.values(state.values)).toEqual([false]);

    state = layer.setValues({ projectId: 'p1', ref: docA, expectedRevision: 1 }, { 已读: true, 作者: 'Ada' });
    state = layer.tagObject({ projectId: 'p1', ref: docA, expectedRevision: state.revision }, ['任务']);
    expect(state.fields.map(field => [field.property.name, field.tagIds.length])).toEqual([
      ['作者', 1], ['年份', 1], ['已读', 2], ['截止', 1],
    ]);
    // 已有值时不再用默认值覆盖。
    expect(Object.values(state.values)).toContain(true);
  });

  it('去掉标签后字段不显示但值保留，重新打上即恢复', () => {
    const { layer } = paperSetup();
    let state = layer.tagObject({ projectId: 'p1', ref: docA, expectedRevision: 0 }, ['论文']);
    state = layer.setValues({ projectId: 'p1', ref: docA, expectedRevision: state.revision }, { 作者: 'Ada' });
    state = layer.untagObject({ projectId: 'p1', ref: docA, expectedRevision: state.revision }, ['论文']);
    expect(state.fields).toEqual([]);
    expect(state.values).toEqual({});
    state = layer.tagObject({ projectId: 'p1', ref: docA, expectedRevision: state.revision }, ['论文']);
    expect(Object.values(state.values)).toContain('Ada');
  });

  it('空值合同：null、空字符串、空列表都存为未设置；勾选 false 是值', () => {
    const { layer, db } = paperSetup();
    layer.defineProperty({ name: '关键词', valueType: 'multi_select', options: ['A', 'B'] });
    layer.setTagFields('论文', [{ propertyId: '作者' }, { propertyId: '已读', defaultValue: false }, { propertyId: '关键词' }]);
    let state = layer.tagObject({ projectId: 'p1', ref: docA, expectedRevision: 0 }, ['论文']);
    state = layer.setValues({ projectId: 'p1', ref: docA, expectedRevision: state.revision }, { 作者: 'Ada', 关键词: ['b', 'B', 'A'] });
    expect(Object.values(state.values)).toContainEqual([expect.any(String), expect.any(String)]);
    state = layer.setValues({ projectId: 'p1', ref: docA, expectedRevision: state.revision }, { 作者: '', 关键词: [] });
    const stored = db.prepare("SELECT json(property_values) AS v FROM semantic_object_values WHERE object_id = 'doc-a'").get() as { v: string };
    expect(Object.values(JSON.parse(stored.v))).toEqual([false]);
    expect(Object.values(state.values)).toEqual([false]);
  });

  it('值按字段类型校验：日期是日历日，日期时间必须带时区', () => {
    const { layer } = paperSetup();
    layer.defineProperty({ name: '开会', valueType: 'datetime' });
    layer.setTagFields('任务', [{ propertyId: '截止' }, { propertyId: '开会' }]);
    const state = layer.tagObject({ projectId: 'p1', ref: docA, expectedRevision: 0 }, ['任务']);
    const write = { projectId: 'p1', ref: docA, expectedRevision: state.revision };
    expect(codeOf(() => layer.setValues(write, { 截止: '2026-02-30' }))).toBe('invalid_value');
    expect(codeOf(() => layer.setValues(write, { 开会: '2026-11-10T09:30:00' }))).toBe('invalid_value');
    expect(codeOf(() => layer.setValues(write, { 截止: '2026-11-10', 开会: '2026-11-10T09:30:00+08:00' }))).toBeUndefined();
  });

  it('只能写当前标签带来的字段；写错字段名时列出可用字段', () => {
    const { layer } = paperSetup();
    const state = layer.tagObject({ projectId: 'p1', ref: docA, expectedRevision: 0 }, ['论文']);
    const write = { projectId: 'p1', ref: docA, expectedRevision: state.revision };
    expect(codeOf(() => layer.setValues(write, { 截止: '2026-11-10' }))).toBe('field_not_available');
    try {
      layer.setValues(write, { 作着: 'x' });
    } catch (error) {
      expect(error).toMatchObject({ code: 'unknown_property', details: { available: ['作者', '年份', '已读'] } });
    }
  });

  it('期望版本不符时拒绝写入；没有变化的写入不加版本', () => {
    const { layer } = paperSetup();
    const state = layer.tagObject({ projectId: 'p1', ref: docA, expectedRevision: 0 }, ['论文']);
    expect(codeOf(() => layer.tagObject({ projectId: 'p1', ref: docA, expectedRevision: 0 }, ['任务']))).toBe('revision_conflict');
    expect(layer.tagObject({ projectId: 'p1', ref: docA, expectedRevision: state.revision }, ['论文']).revision).toBe(state.revision);
  });

  it('文档必须在当前项目、不在回收站，且不是文件夹；对话第一版不开放', () => {
    const { layer } = paperSetup();
    const write = (id: string, projectId = 'p1') => () =>
      layer.tagObject({ projectId, ref: { kind: 'document', id }, expectedRevision: 0 }, ['论文']);
    expect(codeOf(write('doc-other'))).toBe('outside_project');
    expect(codeOf(write('trashed'))).toBe('object_not_found');
    expect(codeOf(write('missing'))).toBe('object_not_found');
    expect(codeOf(write('folder'))).toBe('unsupported_kind');
    expect(codeOf(() => layer.tagObject({ projectId: 'p1', ref: { kind: 'conversation', id: 'c1' }, expectedRevision: 0 }, ['论文'])))
      .toBe('unsupported_kind');
  });

  it('改动登记进账本：执行者来自入口，版本引用指向对象版本', () => {
    const { layer, db } = paperSetup();
    withActionActor(run, () => {
      const state = layer.tagObject({ projectId: 'p1', ref: docA, expectedRevision: 0 }, ['论文']);
      layer.setValues({ projectId: 'p1', ref: docA, expectedRevision: state.revision }, { 作者: 'Ada' });
    });
    const rows = db.prepare(`
      SELECT action, granularity, part, before_ref, after_ref, actor_kind, run_id, summary_json
      FROM action_ledger_entries ORDER BY id
    `).all();
    expect(rows).toEqual([
      expect.objectContaining({ action: 'tag', granularity: 'fine', part: 'properties', before_ref: '0', after_ref: '1', actor_kind: 'run', run_id: 'run-1' }),
      expect.objectContaining({ action: 'set_props', before_ref: '1', after_ref: '2' }),
    ]);
    const versions = db.prepare("SELECT revision, tag_ids_json FROM semantic_object_versions WHERE object_id = 'doc-a' ORDER BY revision").all();
    expect(versions).toHaveLength(2);
    const changes = createSqliteActionLedger(db).listDocumentChanges({ projectId: 'p1', rootRunId: 'run-1', limit: 10 });
    expect(changes.changes[0]).toMatchObject({ documentId: 'doc-a', actions: expect.arrayContaining(['tag', 'set_props']) });
  });

  it('文档物理删除时标签、值与版本随之级联删除', () => {
    const { layer, db } = paperSetup();
    const state = layer.tagObject({ projectId: 'p1', ref: docA, expectedRevision: 0 }, ['论文']);
    layer.setValues({ projectId: 'p1', ref: docA, expectedRevision: state.revision }, { 作者: 'Ada' });
    db.exec("DELETE FROM workspace_nodes WHERE id = 'doc-a'");
    for (const table of ['semantic_object_tags', 'semantic_object_values', 'semantic_object_versions']) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(), table).toEqual({ n: 0 });
    }
  });

  it('外层事务回滚时语义层写入一起回滚', () => {
    const { layer, db } = paperSetup();
    expect(() => db.transaction(() => {
      layer.tagObject({ projectId: 'p1', ref: docA, expectedRevision: 0 }, ['论文']);
      throw new Error('owner failed');
    })()).toThrow('owner failed');
    expect(layer.readObject('p1', docA).revision).toBe(0);
  });
});

describe('恢复版本', () => {
  it('恢复到旧版本是一次新写入；0 表示清空', () => {
    const { layer } = setup();
    layer.defineProperty({ name: '作者', valueType: 'text' });
    layer.defineTag({ name: '论文', fields: [{ propertyId: '作者' }] });
    let state = layer.tagObject({ projectId: 'p1', ref: docA, expectedRevision: 0 }, ['论文']);
    state = layer.setValues({ projectId: 'p1', ref: docA, expectedRevision: state.revision }, { 作者: 'Ada' });
    state = layer.setValues({ projectId: 'p1', ref: docA, expectedRevision: state.revision }, { 作者: 'Grace' });
    state = layer.restoreObject({ projectId: 'p1', ref: docA, expectedRevision: state.revision }, 2);
    expect(state.revision).toBe(4);
    expect(Object.values(state.values)).toEqual(['Ada']);
    state = layer.restoreObject({ projectId: 'p1', ref: docA, expectedRevision: state.revision }, 0);
    expect(state.tags).toEqual([]);
    expect(codeOf(() => layer.restoreObject({ projectId: 'p1', ref: docA, expectedRevision: state.revision }, 99))).toBe('invalid_value');
  });
});
