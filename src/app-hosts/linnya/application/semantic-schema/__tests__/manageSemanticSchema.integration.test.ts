import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PROJECT_SAVED_FILTER_DEFINITION_VERSION,
  SemanticSchemaManageResultSchema,
  type ProjectSavedFilterDefinition,
  type SemanticSchemaManageRequest,
  type SemanticSchemaManageResult,
  type SemanticSchemaOperation,
} from '@app/schemas';
import { createProjectLifecycle } from 'src/domains/projects';
import { createSqliteSemanticLayer } from 'src/domains/semantic-layer';
import { DatabaseService } from 'src/electron-main/services/database';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import { readWorkspaceDocumentIdentity } from 'src/features/workspace/infrastructure/sqlite/workspaceDocumentProjection';
import { createSqliteSavedFilterStore } from '../../../adapters/persistence/saved-filters';
import { manageSemanticSchema } from '../orchestration/manageSemanticSchema';

let database: DatabaseService;
let workspace: WorkspaceService;
let now: number;

beforeEach(() => {
  now = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => (now += 10));
  database = new DatabaseService(':memory:');
  database.initialize();
  workspace = new WorkspaceService(database.getDb());
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

type Success = Extract<SemanticSchemaManageResult, { ok: true }>;

function manage(request: SemanticSchemaManageRequest): SemanticSchemaManageResult {
  // 每个结果都按合同校验。
  return SemanticSchemaManageResultSchema.parse(manageSemanticSchema(database.getDb(), request));
}

function ok<A extends Success['action']>(action: A, request: SemanticSchemaManageRequest & { action: A }): Extract<Success, { action: A }> {
  const result = manage(request);
  if (!result.ok || result.action !== action) throw new Error(JSON.stringify(result));
  return result as Extract<Success, { action: A }>;
}

/** 两个项目：调研里两份带“研究论文”、一份带“论文”；资料里一份带“论文”。 */
function seed() {
  const db = database.getDb();
  const projects = createProjectLifecycle(db);
  const research = projects.create({ name: '调研' });
  const library = projects.create({ name: '资料' });
  const doc = (projectId: string, name: string) => workspace.createDocument(projectId, name);
  const [a, b, c, d] = [doc(research, 'a.md'), doc(research, 'b.md'), doc(research, 'c.md'), doc(library, 'd.md')];
  const layer = createSqliteSemanticLayer(db, { read: id => readWorkspaceDocumentIdentity(db, id) });
  const status = layer.defineProperty({ name: '状态', valueType: 'select', options: ['待读', '读完'] });
  const year = layer.defineProperty({ name: '年份', valueType: 'text' });
  const paper = layer.defineTag({ name: '论文', fields: [{ propertyId: year.id }] });
  const research2 = layer.defineTag({ name: '研究论文', fields: [{ propertyId: status.id }, { propertyId: year.id }], allowSimilar: true });
  const write = (projectId: string, id: string) => ({
    projectId, ref: { kind: 'document', id } as const,
    expectedRevision: layer.readObject(projectId, { kind: 'document', id }).revision,
  });
  layer.tagObject(write(research, a), ['研究论文']);
  layer.setValues(write(research, a), { 状态: '读完', 年份: '2021' });
  layer.tagObject(write(research, b), ['研究论文']);
  layer.setValues(write(research, b), { 年份: '约 2019' });
  layer.tagObject(write(research, c), ['论文']);
  layer.tagObject(write(library, d), ['论文']);
  const store = createSqliteSavedFilterStore(db);
  const board = store.create({
    projectId: research, name: '文稿进度', origin: 'user', pinned: true, conversationId: null,
    definition: definition({
      tags: [research2.id], where: [{ field: status.id, op: 'eq', value: status.options[1].id }],
      layout: { kind: 'board', group_by: status.id },
    }),
  });
  const plain = store.create({
    projectId: library, name: '全部论文', origin: 'user', pinned: true, conversationId: null, definition: definition({ tags: [paper.id] }),
  });
  return { db, research, library, a, b, c, d, status, year, paper, research2, board, plain, store };
}

describe('读出', () => {
  it('标签带文档数、相近名称、创建者；字段带填值数', () => {
    const { paper, research2, status, year } = seed();
    const overview = ok('read', { action: 'read' }).overview;
    const tags = new Map(overview.tags.map(tag => [tag.name, tag]));
    expect(tags.get('论文')).toMatchObject({ document_count: 2, similar: [{ id: research2.id, name: '研究论文' }] });
    expect(tags.get('研究论文')).toMatchObject({ document_count: 2, field_ids: [status.id, year.id] });
    expect(tags.get('论文')?.created_by).toEqual({ kind: 'user', conversation_id: null, conversation_title: null, agent_id: null });
    const properties = new Map(overview.properties.map(property => [property.name, property]));
    expect(properties.get('年份')?.document_count).toBe(2);
    expect([...(properties.get('年份')?.tag_ids ?? [])].sort()).toEqual([paper.id, research2.id].sort());
    expect(properties.get('状态')).toMatchObject({ value_type: 'select', document_count: 1 });
  });

  it('用在哪里：文档按项目分组，并列出引用它的保存的筛选', () => {
    const { paper } = seed();
    const usage = ok('usage', { action: 'usage', kind: 'tag', id: paper.id }).usage;
    expect(usage.projects.map(project => [project.name, project.document_count])).toEqual([['调研', 1], ['资料', 1]]);
    expect(usage.documents.map(document => document.title)).toEqual(['c.md', 'd.md']);
    expect(usage.saved_filters.map(filter => [filter.name, filter.project_name])).toEqual([['全部论文', '资料']]);
  });
});

describe('合并', () => {
  it('预览给出文档数、已带目标的、补上的字段与要改写的筛选', () => {
    const { research2, paper } = seed();
    const preview = ok('preview', { action: 'preview', operation: { op: 'merge_tags', source: research2.id, target: paper.id } }).preview;
    expect(preview).toMatchObject({ kind: 'tag', documents: 2, already_target: 0, added_fields: ['状态'] });
    if (preview.kind !== 'tag') throw new Error('kind');
    expect(preview.saved_filters.map(filter => filter.name)).toEqual(['文稿进度']);
  });

  it('执行时保存的筛选一起改用目标标签；撤回整批恢复', () => {
    const { research2, paper, board, store, research } = seed();
    const applied = ok('apply', { action: 'apply', operation: { op: 'merge_tags', source: '研究论文', target: '论文' } });
    expect(applied.change).toMatchObject({ summary: { kind: 'merge_tags', objects: 2 }, saved_filter_count: 1, undone_at: null });
    expect(applied.overview.tags.map(tag => tag.name)).toEqual(['论文']);
    expect(store.read(research, board.id).definition.tags).toEqual([paper.id]);
    const undone = ok('undo', { action: 'undo', change_id: applied.change.id });
    expect(undone.saved_filters_skipped).toBe(0);
    expect(store.read(research, board.id).definition).toEqual(board.definition);
    expect(undone.overview.tags.map(tag => tag.name).sort()).toEqual(['论文', '研究论文'].sort());
    expect(undone.overview.changes[0]).toMatchObject({ id: applied.change.id, undone_at: expect.any(Number) });
    expect(research2.id).toBeTruthy();
  });

  it('筛选在改动之后又被用户改过时，撤回不覆盖它', () => {
    const { board, store, research } = seed();
    const applied = ok('apply', { action: 'apply', operation: { op: 'merge_tags', source: '研究论文', target: '论文' } });
    store.update(research, board.id, { definition: definition({ node_type: 'document' }) });
    const undone = ok('undo', { action: 'undo', change_id: applied.change.id });
    expect(undone.saved_filters_skipped).toBe(1);
    expect(store.read(research, board.id).definition.node_type).toBe('document');
  });
});

describe('删除与改类型', () => {
  it('删除字段：筛选去掉它的条件，看板按它分列的改回表格', () => {
    const { board, store, research, status } = seed();
    const applied = ok('apply', { action: 'apply', operation: { op: 'delete_property', property: status.id } });
    const after = store.read(research, board.id).definition;
    expect(after.where).toEqual([]);
    expect(after.layout).toEqual({ kind: 'table', group_by: null });
    ok('undo', { action: 'undo', change_id: applied.change.id });
    expect(store.read(research, board.id).definition).toEqual(board.definition);
  });

  it('改类型预览带上样例文档名', () => {
    const { year } = seed();
    const preview = ok('preview', { action: 'preview', operation: { op: 'change_property_type', property: year.id, value_type: 'number' } }).preview;
    if (preview.kind !== 'type') throw new Error('kind');
    expect([preview.total, preview.converted, preview.failed]).toEqual([2, 1, 1]);
    expect(preview.samples.failed).toEqual([{ document: expect.objectContaining({ title: 'b.md' }), from: '约 2019', to: null }]);
  });

  it('编辑选项：预览给出被删的选项与受影响的文档，筛选里用到被删选项的条件去掉', () => {
    const { status, board, store, research } = seed();
    const operation: SemanticSchemaOperation = { op: 'update_options', property: status.id, options: [{ id: status.options[0].id, name: '待读' }] };
    const preview = ok('preview', { action: 'preview', operation }).preview;
    expect(preview).toMatchObject({ kind: 'options', removed: ['读完'], documents: 1 });
    // 预览不写库。
    expect(ok('read', { action: 'read' }).overview.properties.find(item => item.id === status.id)?.options).toHaveLength(2);
    ok('apply', { action: 'apply', operation });
    expect(store.read(research, board.id).definition.where).toEqual([]);
    expect(store.read(research, board.id).definition.layout).toEqual({ kind: 'board', group_by: status.id });
  });

  it('改标签带的字段：按给出的顺序替换，值不动', () => {
    const { paper, status, year, research, c } = seed();
    const overview = ok('set_tag_fields', { action: 'set_tag_fields', tag: paper.id, field_ids: [status.id, year.id] }).overview;
    expect(overview.tags.find(tag => tag.id === paper.id)?.field_ids).toEqual([status.id, year.id]);
    expect(research && c).toBeTruthy();
  });

  it('语义层的错误原样返回，名称相近时带候选', () => {
    seed();
    const result = manage({ action: 'apply', operation: { op: 'rename_tag', tag: '论文', name: '研究论文集' } });
    expect(result).toMatchObject({ ok: false, code: 'similar_name' });
    expect(manage({ action: 'undo', change_id: 'missing' })).toMatchObject({ ok: false, code: 'change_not_found' });
  });
});
