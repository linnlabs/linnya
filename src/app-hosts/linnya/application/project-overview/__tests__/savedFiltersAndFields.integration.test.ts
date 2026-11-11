import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PROJECT_SAVED_FILTER_DEFINITION_VERSION,
  PROJECT_SAVED_FILTER_SUGGESTION_TTL_MS,
  projectSavedFilterConditionKey,
  type ProjectSavedFilterDefinition,
} from '@app/schemas';
import { withActionActor } from 'src/domains/action-ledger';
import { createProjectLifecycle } from 'src/domains/projects';
import { createSqliteSemanticLayer } from 'src/domains/semantic-layer';
import { DatabaseService } from 'src/electron-main/services/database';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import { readWorkspaceDocumentIdentity } from 'src/features/workspace/infrastructure/sqlite/workspaceDocumentProjection';
import { createSqliteSavedFilterStore } from '../../../adapters/persistence/saved-filters';
import { handleProjectSavedFilters } from '../orchestration/handleProjectSavedFilters';
import { matchProjectFields } from '../orchestration/matchProjectFields';
import { readProjectOverview } from '../orchestration/readProjectOverview';
import { setProjectField } from '../orchestration/setProjectField';

let database: DatabaseService;
let workspace: WorkspaceService;
let projectId: string;
let now: number;

beforeEach(() => {
  now = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => (now += 10));
  database = new DatabaseService(':memory:');
  database.initialize();
  workspace = new WorkspaceService(database.getDb());
  projectId = createProjectLifecycle(database.getDb()).create({ name: 'Filters' });
});

afterEach(() => {
  database.close();
  vi.restoreAllMocks();
});

function definition(patch: Partial<ProjectSavedFilterDefinition> = {}): ProjectSavedFilterDefinition {
  return {
    version: PROJECT_SAVED_FILTER_DEFINITION_VERSION,
    node_type: null, modified: 'any', location: null, tags: [], where: [], sort: null,
    layout: { kind: 'table', group_by: null },
    ...patch,
  };
}

/** 两份文档：a 打了“论文”并填了状态，b 没有标签。 */
function seedPapers() {
  const db = database.getDb();
  const a = { id: workspace.createDocument(projectId, 'a.md') };
  const b = { id: workspace.createDocument(projectId, 'b.md') };
  const layer = createSqliteSemanticLayer(db, { read: id => readWorkspaceDocumentIdentity(db, id) });
  const status = layer.defineProperty({ name: '状态', valueType: 'select', options: ['待读', '在读', '读完'] });
  const read = layer.defineProperty({ name: '已读', valueType: 'checkbox' });
  layer.defineProperty({ name: '没挂标签', valueType: 'text' });
  const paper = layer.defineTag({ name: '论文', fields: [{ propertyId: status.id }, { propertyId: read.id }] });
  layer.tagObject({ projectId, ref: { kind: 'document', id: a.id }, expectedRevision: 0 }, ['论文']);
  layer.setValues({ projectId, ref: { kind: 'document', id: a.id }, expectedRevision: 1 }, { 状态: '待读' });
  return { a, b, status, read, paper };
}

describe('项目概览：字段值', () => {
  it('每份文档带版本、当前字段与已填的值；只给挂在标签上的字段定义', () => {
    const { a, status, read } = seedPapers();
    const overview = readProjectOverview(database.getDb(), { project_id: projectId });
    const byTitle = new Map(overview.documents.map(document => [document.title, document]));
    expect(byTitle.get('a.md')?.properties).toEqual({
      revision: 2, field_ids: [status.id, read.id], values: { [status.id]: status.options[0].id },
    });
    expect(byTitle.get('b.md')?.properties).toEqual({ revision: 0, field_ids: [], values: {} });
    expect(overview.fields.map(field => field.name).sort()).toEqual(['已读', '状态']);
    expect(overview.fields.find(field => field.id === status.id)).toMatchObject({
      value_type: 'select', readonly: false, options: status.options.map(option => ({ id: option.id, name: option.name })),
    });
    expect(a.id).toBeTruthy();
  });
});

describe('字段条件与看板改值', () => {
  it('字段条件与 CLI 同一套含义：勾选“未勾选”含未设置，没打标签的不算', () => {
    const { a, read } = seedPapers();
    const result = matchProjectFields(database.getDb(), { project_id: projectId, where: [{ field: read.id, op: 'eq', value: false }] });
    expect(result).toEqual({ ok: true, document_ids: [a.id] });
  });

  it('字段已不存在时给出原因，不当成没有结果', () => {
    seedPapers();
    const result = matchProjectFields(database.getDb(), { project_id: projectId, where: [{ field: 'gone', op: 'empty' }] });
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('gone') });
  });

  it('拖动改值：按期望版本写入并以用户身份记账；版本过期时报冲突', () => {
    const { a, status } = seedPapers();
    const db = database.getDb();
    const result = withActionActor({ kind: 'user' }, () => setProjectField(db, {
      project_id: projectId, document_id: a.id, field_id: status.id, value: status.options[1].id, expected_revision: 2,
    }));
    expect(result).toEqual({ ok: true, revision: 3 });
    const last = db.prepare('SELECT action, actor_kind, before_ref, after_ref FROM action_ledger_entries WHERE document_id = ? ORDER BY id DESC').get(a.id);
    expect(last).toEqual({ action: 'set_props', actor_kind: 'user', before_ref: '2', after_ref: '3' });

    const stale = withActionActor({ kind: 'user' }, () => setProjectField(db, {
      project_id: projectId, document_id: a.id, field_id: status.id, value: null, expected_revision: 2,
    }));
    expect(stale).toMatchObject({ ok: false, code: 'revision_conflict' });
  });
});

describe('保存的筛选', () => {
  it('界面保存的直接固定；改名、改条件、删除都只动这一项', () => {
    const db = database.getDb();
    const first = handleProjectSavedFilters(db, { action: 'create', project_id: projectId, name: '论文', definition: definition({ tags: ['t1'] }) });
    expect(first.filters).toHaveLength(1);
    expect(first.filters[0]).toMatchObject({ name: '论文', origin: 'user', pinned: true, conversation_id: null });

    const second = handleProjectSavedFilters(db, { action: 'create', project_id: projectId, name: '本周', definition: definition({ modified: 'week' }) });
    expect(second.filters.map(filter => filter.name)).toEqual(['论文', '本周']);

    const renamed = handleProjectSavedFilters(db, {
      action: 'update', project_id: projectId, id: first.filters[0].id, name: '待读论文',
      definition: definition({ tags: ['t1'], layout: { kind: 'board', group_by: 'f1' } }),
    });
    expect(renamed.filters[0]).toMatchObject({ name: '待读论文', definition: { layout: { kind: 'board', group_by: 'f1' } } });

    const deleted = handleProjectSavedFilters(db, { action: 'delete', project_id: projectId, id: second.saved_id ?? '' });
    expect(deleted.filters.map(filter => filter.name)).toEqual(['待读论文']);
    expect(() => handleProjectSavedFilters(db, { action: 'delete', project_id: projectId, id: 'missing' })).toThrow();
  });

  it('Agent 建议不占那一排；固定后排到最后；30 天没打开的建议在列出时清理', () => {
    const db = database.getDb();
    const store = createSqliteSavedFilterStore(db);
    handleProjectSavedFilters(db, { action: 'create', project_id: projectId, name: '论文', definition: definition({ tags: ['t1'] }) });
    const suggestion = store.create({
      projectId, name: '待读', origin: 'agent', pinned: false, conversationId: null, definition: definition({ tags: ['t2'] }),
    });
    const stale = store.create({
      projectId, name: '旧建议', origin: 'agent', pinned: false, conversationId: null, definition: definition({ tags: ['t3'] }),
    });
    expect(store.list(projectId).map(filter => [filter.name, filter.pinned])).toEqual([['论文', true], ['待读', false], ['旧建议', false]]);

    now += PROJECT_SAVED_FILTER_SUGGESTION_TTL_MS - 1_000;
    handleProjectSavedFilters(db, { action: 'open', project_id: projectId, id: suggestion.id });
    now += 2_000;
    const listed = handleProjectSavedFilters(db, { action: 'list', project_id: projectId });
    expect(listed.filters.map(filter => filter.name)).toEqual(['论文', '待读']);
    expect(listed.filters.some(filter => filter.id === stale.id)).toBe(false);

    const pinned = handleProjectSavedFilters(db, { action: 'update', project_id: projectId, id: suggestion.id, pinned: true });
    expect(pinned.filters.map(filter => [filter.name, filter.pinned])).toEqual([['论文', true], ['待读', true]]);
  });

  it('条件相同的判据不计标签与条件先后，也不比排序和布局', () => {
    const left = definition({ tags: ['b', 'a'], where: [{ field: 'x', op: 'contains', value: ['2', '1'] }, { field: 'y', op: 'empty' }] });
    const right = definition({
      tags: ['a', 'b'], where: [{ field: 'y', op: 'empty' }, { field: 'x', op: 'contains', value: ['1', '2'] }],
      sort: { key: 'name', direction: 'asc' }, layout: { kind: 'board', group_by: 'f' },
    });
    expect(projectSavedFilterConditionKey(left)).toBe(projectSavedFilterConditionKey(right));
    expect(projectSavedFilterConditionKey(left)).not.toBe(projectSavedFilterConditionKey(definition({ tags: ['a'] })));
  });

  it('项目删除时一起删除', () => {
    const db = database.getDb();
    handleProjectSavedFilters(db, { action: 'create', project_id: projectId, name: '论文', definition: definition() });
    db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    expect(db.prepare('SELECT COUNT(*) AS count FROM project_saved_filters').get()).toEqual({ count: 0 });
  });
});
