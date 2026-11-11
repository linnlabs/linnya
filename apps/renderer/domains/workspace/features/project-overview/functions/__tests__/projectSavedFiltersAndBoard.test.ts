import { describe, expect, it } from 'vitest';
import type { ProjectOverviewField, ProjectSavedFilter } from '@app/schemas';
import {
  DEFAULT_PROJECT_OVERVIEW_SORT,
  DEFAULT_PROJECT_OVERVIEW_VIEW,
  EMPTY_PROJECT_OVERVIEW_FILTERS,
  type ProjectOverviewRow,
} from '../../definitions/projectOverview';
import { boardCardFieldsText, groupProjectOverviewBoard, isBoardGroupField } from '../projectOverviewBoard';
import {
  allFilesView,
  arrangeSavedFilters,
  defaultSavedFilterName,
  fieldConditionText,
  fileViewFromSavedFilter,
  findSameConditions,
  isSavedFilterChanged,
  savedFilterDefinitionFrom,
  type FieldConditionLabels,
} from '../projectSavedFilters';

const status: ProjectOverviewField = {
  id: 'status', name: '状态', value_type: 'select', readonly: false,
  options: [{ id: 'todo', name: '待读' }, { id: 'doing', name: '在读' }, { id: 'done', name: '读完' }],
};
const author: ProjectOverviewField = { id: 'author', name: '作者', value_type: 'text', readonly: false, options: [] };
const read: ProjectOverviewField = { id: 'read', name: '已读', value_type: 'checkbox', readonly: false, options: [] };

const row = (id: string, values: Record<string, unknown>, fieldIds = ['status', 'author', 'read']): ProjectOverviewRow => ({
  documentId: id, nodeType: 'document', title: id, parentId: null, location: [], createdAt: 0,
  creatorActor: null, creatorPluginId: null, conversationId: null, conversationTitle: null,
  lastModifiedAt: 0, lastModifiedActor: null, lastModifiedPluginId: null, pendingRevisionCount: null,
  tags: [], fieldRevision: 1, fieldIds, fieldValues: values,
});

const saved = (id: string, definition = savedFilterDefinitionFrom(allFilesView(''))): ProjectSavedFilter => ({
  id, name: id, origin: 'user', pinned: true, conversation_id: null, definition, created_at: 0, updated_at: 0, last_opened_at: 0,
});

describe('保存的筛选：界面状态与定义互转', () => {
  it('搜索不进定义；默认排序存成 null；表格不记分列字段', () => {
    const definition = savedFilterDefinitionFrom({
      filters: { ...EMPTY_PROJECT_OVERVIEW_FILTERS, tags: ['t'], query: '电池' },
      sort: DEFAULT_PROJECT_OVERVIEW_SORT,
      view: { kind: 'table', groupBy: 'status' },
    });
    expect(definition).toMatchObject({ tags: ['t'], sort: null, layout: { kind: 'table', group_by: null } });
    const back = fileViewFromSavedFilter({ ...definition, sort: { key: 'gone', direction: 'asc' } }, '保留的搜索');
    expect(back.sort).toEqual(DEFAULT_PROJECT_OVERVIEW_SORT);
    expect(back.filters.query).toBe('保留的搜索');
  });

  it('已改动：比条件、排序与布局，不比搜索；看板换分列字段也算', () => {
    const base = savedFilterDefinitionFrom({ filters: EMPTY_PROJECT_OVERVIEW_FILTERS, sort: DEFAULT_PROJECT_OVERVIEW_SORT, view: { kind: 'board', groupBy: 'status' } });
    const searched = savedFilterDefinitionFrom({ filters: { ...EMPTY_PROJECT_OVERVIEW_FILTERS, query: 'x' }, sort: DEFAULT_PROJECT_OVERVIEW_SORT, view: { kind: 'board', groupBy: 'status' } });
    expect(isSavedFilterChanged(searched, base)).toBe(false);
    expect(isSavedFilterChanged({ ...base, layout: { kind: 'board', group_by: 'other' } }, base)).toBe(true);
    expect(isSavedFilterChanged({ ...base, sort: { key: 'name', direction: 'asc' } }, base)).toBe(true);
    expect(isSavedFilterChanged({ ...base, layout: { kind: 'table', group_by: null } }, base)).toBe(true);
  });

  it('条件相同时找出已有那一项，不看排序与布局', () => {
    const paper = saved('论文', savedFilterDefinitionFrom({ filters: { ...EMPTY_PROJECT_OVERVIEW_FILTERS, tags: ['a', 'b'] }, sort: DEFAULT_PROJECT_OVERVIEW_SORT, view: DEFAULT_PROJECT_OVERVIEW_VIEW }));
    const same = savedFilterDefinitionFrom({ filters: { ...EMPTY_PROJECT_OVERVIEW_FILTERS, tags: ['b', 'a'] }, sort: { key: 'name', direction: 'asc' }, view: { kind: 'board', groupBy: 'status' } });
    expect(findSameConditions([paper], same)?.id).toBe('论文');
    expect(findSameConditions([paper], savedFilterDefinitionFrom(allFilesView('')))).toBeNull();
  });

  it('那一排放不下时收进更多；正在看的在更多里时换到最后一个位置', () => {
    const list = ['a', 'b', 'c', 'd'].map(id => saved(id));
    expect(arrangeSavedFilters(list, 'a', 3)).toMatchObject({ visible: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], overflow: [{ id: 'd' }] });
    expect(arrangeSavedFilters(list, 'd', 3)).toMatchObject({ visible: [{ id: 'a' }, { id: 'b' }, { id: 'd' }], overflow: [{ id: 'c' }] });
  });

  it('条件文字与默认名称', () => {
    const labels: FieldConditionLabels = {
      fieldName: id => [status, author, read].find(field => field.id === id)?.name ?? null,
      builtinName: field => (field === 'type' ? '类型' : null),
      unknownField: '已删除的字段', checked: '已勾选', unchecked: '未勾选', empty: '未填', notEmpty: '已填',
      negated: value => `不是 ${value}`, contains: value => `包含 ${value}`, notContains: value => `不含 ${value}`,
      join: '、', pair: (label, value) => `${label}：${value}`,
    };
    const fields = [status, author, read];
    expect(fieldConditionText({ field: 'read', op: 'eq', value: false }, fields, labels)).toBe('已读：未勾选');
    expect(fieldConditionText({ field: 'status', op: 'eq', value: 'todo' }, fields, labels)).toBe('状态：待读');
    expect(fieldConditionText({ field: 'status', op: 'contains', value: ['todo', 'done'] }, fields, labels)).toBe('状态：包含 待读、读完');
    expect(fieldConditionText({ field: 'gone', op: 'empty' }, fields, labels)).toBe('已删除的字段：未填');
    expect(fieldConditionText({ field: 'year', op: 'gte', value: 2017 }, fields, { ...labels, fieldName: () => '年份' })).toBe('年份 ≥ 2017');
    expect(defaultSavedFilterName(['论文', null, '最近 7 天'], '新筛选')).toBe('论文 · 最近 7 天');
    expect(defaultSavedFilterName([null], '看板')).toBe('看板');
  });
});

describe('看板', () => {
  it('按选项顺序分列，没填和指向已删除选项的放最后一列；标签不带字段的不进看板', () => {
    const rows = [
      row('a', { status: 'done' }), row('b', {}), row('c', { status: 'removed-option' }),
      row('d', { status: 'todo' }), row('e', {}, ['author']),
    ];
    const board = groupProjectOverviewBoard(rows, status, '未填');
    expect(board.lanes.map(lane => [lane.name, lane.rows.map(item => item.documentId)])).toEqual([
      ['待读', ['d']], ['在读', []], ['读完', ['a']], ['未填', ['b', 'c']],
    ]);
    expect(board.excluded).toBe(1);
  });

  it('拖动后在写入完成前先按界面上的挪动分列', () => {
    const board = groupProjectOverviewBoard([row('a', { status: 'done' })], status, '未填', new Map([['a', 'doing']]));
    expect(board.lanes.find(lane => lane.key === 'doing')?.rows.map(item => item.documentId)).toEqual(['a']);
    const cleared = groupProjectOverviewBoard([row('a', { status: 'done' })], status, '未填', new Map([['a', null]]));
    expect(cleared.lanes[cleared.lanes.length - 1]?.rows).toHaveLength(1);
  });

  it('只能按可写的单选字段分列；卡片上显示其他字段，跳过分列字段与未勾选', () => {
    expect(isBoardGroupField(status)).toBe(true);
    expect(isBoardGroupField({ ...status, readonly: true })).toBe(false);
    expect(isBoardGroupField(read)).toBe(false);
    const fields = [status, author, read];
    expect(boardCardFieldsText(row('a', { status: 'done', author: 'Chen', read: true }), fields, 'status')).toBe('作者 Chen · 已读');
    expect(boardCardFieldsText(row('a', { author: 'Chen', read: false }), fields, 'status')).toBe('作者 Chen');
  });
});
