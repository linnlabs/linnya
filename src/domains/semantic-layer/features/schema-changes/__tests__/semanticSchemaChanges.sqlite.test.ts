import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { withActionActor, type ActionRunActor } from '../../../../action-ledger';
import { ACTION_LEDGER_SCHEMAS } from '../../../../action-ledger/infrastructure/sqlite/actionLedger.schema';
import { SEMANTIC_LAYER_SCHEMAS } from '../../../infrastructure/sqlite/semanticLayer.schema';
import { createSqliteSemanticLayer } from '../../../infrastructure/sqlite/createSqliteSemanticLayer';
import { SemanticLayerError, type SemanticDocumentPort } from '../../../definitions/semanticLayer';

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
    CREATE TABLE runs (id TEXT PRIMARY KEY, agent_spec_id TEXT);
    INSERT INTO runs VALUES ('run-1', 'linnya-ai');
    INSERT INTO projects VALUES ('p1');
    INSERT INTO workspace_nodes VALUES
      ('a', 'p1', 'document', NULL), ('b', 'p1', 'document', NULL), ('c', 'p1', 'document', NULL);
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
  const ref = (docId: string) => ({ kind: 'document', id: docId } as const);
  const write = (docId: string) => ({ projectId: 'p1', ref: ref(docId), expectedRevision: layer.readObject('p1', ref(docId)).revision });
  const tag = (docId: string, ...tags: string[]) => layer.tagObject(write(docId), tags);
  const set = (docId: string, patch: Record<string, unknown>) => layer.setValues(write(docId), patch);
  const read = (docId: string) => layer.readObject('p1', ref(docId));
  const tagNames = (docId: string) => read(docId).tags.map(item => item.name);
  return { db, layer, tag, set, read, tagNames };
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

const run: ActionRunActor = {
  kind: 'run', runId: 'run-1', rootRunId: 'run-1', parentRunId: null, conversationId: 'conv-1', toolCallId: 'call-1',
};

describe('标签改名、合并、删除', () => {
  it('改名检查重名与相近名，不能和自己同名；撤回改回原名', () => {
    const { layer } = setup();
    layer.defineTag({ name: '文献' });
    layer.defineTag({ name: '会议' });
    expect(codeOf(() => layer.renameTag('文献', '会议'))).toBe('name_conflict');
    expect(codeOf(() => layer.renameTag('文献', '文献'))).toBe('invalid_definition');
    const change = layer.renameTag('文献', '论文');
    expect(change.summary).toEqual({ kind: 'rename_tag', from: '文献', to: '论文' });
    expect(layer.listTags().map(item => item.name)).toEqual(['会议', '论文'].sort());
    layer.undoChange(change.id);
    expect(layer.listTags().map(item => item.name).sort()).toEqual(['会议', '文献'].sort());
    expect(codeOf(() => layer.undoChange(change.id))).toBe('already_undone');
  });

  it('改名后又改名时，先撤回后来的', () => {
    const { layer } = setup();
    layer.defineTag({ name: '文献' });
    const first = layer.renameTag('文献', '论文');
    layer.renameTag('论文', '研究论文');
    expect(codeOf(() => layer.undoChange(first.id))).toBe('undo_conflict');
  });

  it('合并：对象改带目标标签，已带的不重复；目标补上来源的字段；撤回整批恢复', () => {
    const { layer, tag, set, read, tagNames } = setup();
    const year = layer.defineProperty({ name: '年份', valueType: 'number' });
    const venue = layer.defineProperty({ name: '会议名', valueType: 'text' });
    layer.defineTag({ name: '论文', fields: [{ propertyId: year.id }] });
    layer.defineTag({ name: '文献', fields: [{ propertyId: year.id }, { propertyId: venue.id }] });
    tag('a', '文献');
    set('a', { 年份: 2024, 会议名: 'NeurIPS' });
    tag('b', '论文', '文献');
    tag('c', '论文');

    const impact = layer.previewTagChange('文献', '论文');
    expect(impact.objects.map(item => item.id)).toEqual(['a', 'b']);
    expect(impact.alreadyTarget.map(item => item.id)).toEqual(['b']);
    expect(impact.addedFields).toEqual(['会议名']);

    const revisionBefore = read('a').revision;
    const change = layer.mergeTags('文献', '论文');
    expect(change.summary).toEqual({ kind: 'merge_tags', source: '文献', target: '论文', objects: 2 });
    expect(tagNames('a')).toEqual(['论文']);
    expect(tagNames('b')).toEqual(['论文']);
    expect(read('a').values).toEqual({ [year.id]: 2024, [venue.id]: 'NeurIPS' });
    expect(read('a').revision).toBe(revisionBefore + 1);
    expect(layer.listTags().map(item => item.name)).toEqual(['论文']);

    layer.undoChange(change.id);
    expect(tagNames('a')).toEqual(['文献']);
    expect(tagNames('b')).toEqual(['论文', '文献']);
    expect(tagNames('c')).toEqual(['论文']);
    expect(layer.listTags().find(item => item.name === '论文')?.fields.map(field => field.propertyId)).toEqual([year.id]);
    expect(read('a').values).toEqual({ [year.id]: 2024, [venue.id]: 'NeurIPS' });
  });

  it('不能合并到自己', () => {
    const { layer } = setup();
    layer.defineTag({ name: '论文' });
    expect(codeOf(() => layer.mergeTags('论文', '论文'))).toBe('invalid_definition');
  });

  it('删除标签：从对象上去掉，值保留；撤回后标签、对象与值都回来', () => {
    const { layer, tag, set, read, tagNames } = setup();
    const status = layer.defineProperty({ name: '状态', valueType: 'select', options: ['待核实', '已核实'] });
    layer.defineTag({ name: '待核实', fields: [{ propertyId: status.id }] });
    tag('a', '待核实');
    set('a', { 状态: '已核实' });
    const change = layer.deleteTag('待核实');
    expect(change.summary).toEqual({ kind: 'delete_tag', tag: '待核实', objects: 1 });
    expect(tagNames('a')).toEqual([]);
    expect(layer.listTags()).toEqual([]);
    layer.undoChange(change.id);
    expect(tagNames('a')).toEqual(['待核实']);
    expect(read('a').values).toEqual({ [status.id]: status.options[1].id });
  });

  it('撤回删除前名称被新标签占用时报冲突', () => {
    const { layer } = setup();
    layer.defineTag({ name: '待核实' });
    const change = layer.deleteTag('待核实');
    layer.defineTag({ name: '待核实' });
    expect(codeOf(() => layer.undoChange(change.id))).toBe('undo_conflict');
  });

  it('撤回时跳过已被物理删除的文档', () => {
    const { db, layer, tag, tagNames } = setup();
    layer.defineTag({ name: '论文' });
    tag('a', '论文');
    tag('b', '论文');
    const change = layer.deleteTag('论文');
    db.prepare("DELETE FROM workspace_nodes WHERE id = 'b'").run();
    layer.undoChange(change.id);
    expect(tagNames('a')).toEqual(['论文']);
  });
});

describe('字段改名、删除、改类型、改选项', () => {
  it('字段改名不能含点，插件字段只读', () => {
    const { db, layer } = setup();
    layer.defineProperty({ name: '作者', valueType: 'text' });
    expect(codeOf(() => layer.renameProperty('作者', 'a.b'))).toBe('reserved_name');
    db.prepare(`INSERT INTO semantic_properties (id, name, name_key, value_type, options_json, owner_plugin_id, created_at)
      VALUES ('slides.pageCount', 'slides.pageCount', 'slides.pagecount', 'number', '[]', 'slides', 1)`).run();
    expect(codeOf(() => layer.renameProperty('slides.pageCount', '页数'))).toBe('readonly_property');
    const change = layer.renameProperty('作者', '第一作者');
    expect(layer.listProperties().map(item => item.name)).toContain('第一作者');
    layer.undoChange(change.id);
    expect(layer.listProperties().map(item => item.name)).toContain('作者');
  });

  it('删除字段：从标签里消失，值不动；撤回后原样显示', () => {
    const { layer, tag, set, read } = setup();
    const author = layer.defineProperty({ name: '作者', valueType: 'text' });
    layer.defineTag({ name: '论文', fields: [{ propertyId: author.id }] });
    tag('a', '论文');
    set('a', { 作者: '张三' });
    const change = layer.deleteProperty('作者');
    expect(read('a').fields).toEqual([]);
    expect(read('a').values).toEqual({});
    layer.undoChange(change.id);
    expect(read('a').values).toEqual({ [author.id]: '张三' });
  });

  it('文字改数字：先预览能转、转不了、变空的个数；执行后转不了的清除，撤回恢复原值', () => {
    const { layer, tag, set, read } = setup();
    const year = layer.defineProperty({ name: '年份', valueType: 'text' });
    layer.defineTag({ name: '论文', fields: [{ propertyId: year.id }] });
    for (const [doc, value] of [['a', '2,024'], ['b', '去年'], ['c', '  ']] as const) {
      tag(doc, '论文');
      set(doc, { 年份: value });
    }
    const preview = layer.previewPropertyType('年份', 'number');
    expect([preview.total, preview.converted, preview.failed, preview.emptied]).toEqual([3, 1, 1, 1]);
    expect(preview.samples.failed).toEqual([{ ref: { kind: 'document', id: 'b' }, from: '去年', to: null }]);
    const change = layer.changePropertyType('年份', 'number');
    expect(change.summary).toMatchObject({ kind: 'change_property_type', fromType: 'text', toType: 'number', objects: 3, failed: 2 });
    expect(read('a').values).toEqual({ [year.id]: 2024 });
    expect(read('b').values).toEqual({});
    expect(codeOf(() => set('a', { 年份: 'abc' }))).toBe('invalid_value');
    layer.undoChange(change.id);
    expect(layer.listProperties()[0].valueType).toBe('text');
    expect(read('a').values).toEqual({ [year.id]: '2,024' });
    expect(read('b').values).toEqual({ [year.id]: '去年' });
    expect(read('c').values).toEqual({ [year.id]: '  ' });
  });

  it('文字改单选按出现先后生成选项；超过上限报错', () => {
    const { layer, tag, set, read } = setup();
    const venue = layer.defineProperty({ name: '会议', valueType: 'text' });
    layer.defineTag({ name: '论文', fields: [{ propertyId: venue.id }] });
    tag('a', '论文'); set('a', { 会议: 'ICML' });
    tag('b', '论文'); set('b', { 会议: 'icml' });
    tag('c', '论文'); set('c', { 会议: 'NeurIPS' });
    const preview = layer.previewPropertyType('会议', 'select');
    expect(preview.toOptions.map(option => option.name)).toEqual(['ICML', 'NeurIPS']);
    expect(preview.converted).toBe(3);
    layer.changePropertyType('会议', 'select');
    const property = layer.listProperties()[0];
    expect(read('a').values[venue.id]).toBe(read('b').values[venue.id]);
    expect(property.options.find(option => option.id === read('c').values[venue.id])?.name).toBe('NeurIPS');
  });

  it('生成的选项超过上限时拒绝改成单选', () => {
    const { layer, tag, set } = setup();
    const note = layer.defineProperty({ name: '备注', valueType: 'text' });
    layer.defineTag({ name: '论文', fields: [{ propertyId: note.id }] });
    tag('a', '论文');
    set('a', { 备注: Array.from({ length: 51 }, (_, index) => `v${index}`).join('、') });
    expect(codeOf(() => layer.previewPropertyType('备注', 'multi_select'))).toBe('invalid_definition');
    expect(layer.previewPropertyType('备注', 'select').toOptions).toHaveLength(1);
  });

  it('改类型后又改了一次，撤回先前那次报冲突', () => {
    const { layer } = setup();
    layer.defineProperty({ name: '年份', valueType: 'text' });
    const first = layer.changePropertyType('年份', 'number');
    layer.changePropertyType('年份', 'text');
    expect(codeOf(() => layer.undoChange(first.id))).toBe('undo_conflict');
  });

  it('编辑选项：改名、调顺序、新增、删除；用到被删选项的值清除，撤回恢复', () => {
    const { layer, tag, set, read } = setup();
    const topics = layer.defineProperty({ name: '主题', valueType: 'multi_select', options: ['电池', '光伏', '储能'] });
    const [battery, solar, storage] = topics.options;
    layer.defineTag({ name: '研究', fields: [{ propertyId: topics.id }] });
    tag('a', '研究'); set('a', { 主题: ['电池', '光伏'] });
    tag('b', '研究'); set('b', { 主题: ['光伏'] });
    tag('c', '研究'); set('c', { 主题: ['储能'] });
    const change = layer.updatePropertyOptions('主题', [
      { id: storage.id, name: '储能系统' }, { id: battery.id, name: '电池' }, { name: '氢能' },
    ]);
    expect(change.summary).toEqual({
      kind: 'update_options', property: '主题', added: ['氢能'],
      renamed: [{ from: '储能', to: '储能系统' }], removed: ['光伏'], objects: 2,
    });
    expect(read('a').values[topics.id]).toEqual([battery.id]);
    expect(read('b').values).toEqual({});
    expect(read('c').values[topics.id]).toEqual([storage.id]);
    layer.undoChange(change.id);
    expect(layer.listProperties()[0].options).toEqual(topics.options);
    expect(read('a').values[topics.id]).toEqual([battery.id, solar.id]);
    expect(read('b').values[topics.id]).toEqual([solar.id]);
  });

  it('选项改动之后又改过，撤回先前那次报冲突', () => {
    const { layer } = setup();
    const status = layer.defineProperty({ name: '状态', valueType: 'select', options: ['草稿', '定稿'] });
    const first = layer.updatePropertyOptions('状态', [{ id: status.options[0].id, name: '初稿' }, { id: status.options[1].id, name: '定稿' }]);
    layer.updatePropertyOptions('状态', [{ id: status.options[0].id, name: '初稿' }]);
    expect(codeOf(() => layer.undoChange(first.id))).toBe('undo_conflict');
  });
});

describe('改动记录', () => {
  it('记下执行者、对话与 Agent；新建标签也记下是谁建的', () => {
    const { layer } = setup();
    withActionActor(run, () => layer.defineTag({ name: '论文' }));
    layer.defineTag({ name: '会议' });
    const byName = new Map(layer.listTags().map(item => [item.name, item.createdBy]));
    expect(byName.get('论文')).toEqual({ kind: 'run', conversationId: 'conv-1', agentId: 'linnya-ai' });
    expect(byName.get('会议')).toEqual({ kind: 'user', conversationId: null, agentId: null });
    const change = withActionActor(run, () => layer.deleteTag('论文'));
    expect(change.actor).toEqual({ kind: 'run', conversationId: 'conv-1', runId: 'run-1', agentId: 'linnya-ai' });
    layer.renameTag('会议', '会议纪要');
    expect(layer.listChanges().map(item => item.summary.kind)).toEqual(['rename_tag', 'delete_tag']);
  });

  it('调用方附上的数据在撤回时原样交还', () => {
    const { db, layer } = setup();
    layer.defineTag({ name: '论文' });
    const result = db.transaction(() => {
      const change = layer.deleteTag('论文');
      layer.attachToChange(change.id, 'savedFilters', [{ id: 'f1' }]);
      return change;
    })();
    expect(layer.readChange(result.id).attachments).toEqual({ savedFilters: [{ id: 'f1' }] });
    expect(layer.undoChange(result.id).attachments).toEqual({ savedFilters: [{ id: 'f1' }] });
    expect(codeOf(() => layer.undoChange('missing'))).toBe('change_not_found');
  });
});
