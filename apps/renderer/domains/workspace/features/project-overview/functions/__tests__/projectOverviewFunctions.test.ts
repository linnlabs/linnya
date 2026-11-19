import { describe, expect, it } from 'vitest';
import { WORKSPACE_MESSAGE_FALLBACKS } from '@/domains/workspace/definitions/workspaceMessageCatalog';
import type { WorkspaceMessageResolver } from '@/domains/workspace/definitions/workspaceMessages';
import { EMPTY_PROJECT_OVERVIEW_FILTERS, type ProjectOverviewRow } from '../../definitions/projectOverview';
import {
  DEFAULT_PROJECT_OVERVIEW_LAYOUT,
  PROJECT_OVERVIEW_MIN_COLUMN_WIDTH,
  moveProjectOverviewColumn,
  normalizeProjectOverviewLayout,
  PROJECT_OVERVIEW_MIN_NAME_WIDTH,
  resizeProjectOverviewName,
  resizeProjectOverviewColumn,
  toggleProjectOverviewColumn,
} from '../projectOverviewLayout';
import { formatProjectOverviewActor, resolveProjectOverviewAgentName } from '../projectOverviewPresentation';
import {
  filterProjectOverviewRows,
  listProjectOverviewTags,
  listProjectOverviewLocations,
  modifiedRangeStart,
  sortProjectOverviewRows,
} from '../projectOverviewRows';

const message: WorkspaceMessageResolver = (key, params) => {
  let text: string = WORKSPACE_MESSAGE_FALLBACKS[key];
  for (const [name, value] of Object.entries(params ?? {})) text = text.replace(`{${name}}`, String(value));
  return text;
};

const row = (overrides: Partial<ProjectOverviewRow> & { readonly documentId: string }): ProjectOverviewRow => ({
  nodeType: 'document',
  title: overrides.documentId,
  parentId: null,
  location: [],
  createdAt: 0,
  creatorActor: null,
  creatorPluginId: null,
  creatorAgentId: null,
  conversationId: null,
  conversationTitle: null,
  lastModifiedAt: 0,
  lastModifiedActor: null,
  lastModifiedPluginId: null,
  lastModifiedAgentId: null,
  pendingRevisionCount: null,
  tags: [],
  fieldRevision: 0,
  fieldIds: [],
  fieldValues: {},
  ...overrides,
});

describe('列配置', () => {
  it('格式坏了或版本不对时用默认；认不出的列丢掉，缺的列按默认位置补上', () => {
    expect(normalizeProjectOverviewLayout(null)).toBe(DEFAULT_PROJECT_OVERVIEW_LAYOUT);
    expect(normalizeProjectOverviewLayout({ version: 2, columns: [] })).toBe(DEFAULT_PROJECT_OVERVIEW_LAYOUT);
    const layout = normalizeProjectOverviewLayout({
      version: 1,
      columns: [
        { id: 'modified', visible: false, width: 9999 },
        { id: 'unknown', visible: true, width: 100 },
        { id: 'location', visible: true, width: 10 },
        { id: 'modified', visible: true, width: 100 },
      ],
    });
    expect(layout.columns.map(column => column.id)).toEqual([
      'tags', 'modified', 'location', 'source', 'conversation', 'pending', 'type', 'created',
    ]);
    expect(layout.columns[1]).toEqual({ id: 'modified', visible: false, width: 480 });
    expect(layout.columns[2]?.width).toBe(PROJECT_OVERVIEW_MIN_COLUMN_WIDTH);
  });

  it('显示、顺序、宽度各自只改一项', () => {
    const toggled = toggleProjectOverviewColumn(DEFAULT_PROJECT_OVERVIEW_LAYOUT, 'type');
    expect(toggled.columns.find(column => column.id === 'type')?.visible).toBe(true);
    const moved = moveProjectOverviewColumn(DEFAULT_PROJECT_OVERVIEW_LAYOUT, 'pending', 'location');
    expect(moved.columns.map(column => column.id).slice(0, 3)).toEqual(['tags', 'pending', 'location']);
    const resized = resizeProjectOverviewColumn(DEFAULT_PROJECT_OVERVIEW_LAYOUT, 'source', 20);
    expect(resized.columns.find(column => column.id === 'source')?.width).toBe(PROJECT_OVERVIEW_MIN_COLUMN_WIDTH);
  });
});

describe('名称列宽', () => {
  it('旧配置没有名称列宽时用默认；保存的宽度按上下限收紧', () => {
    expect(normalizeProjectOverviewLayout({ version: 1, columns: [] }).nameWidth).toBe(DEFAULT_PROJECT_OVERVIEW_LAYOUT.nameWidth);
    expect(normalizeProjectOverviewLayout({ version: 1, nameWidth: 20, columns: [] }).nameWidth).toBe(PROJECT_OVERVIEW_MIN_NAME_WIDTH);
    expect(resizeProjectOverviewName(DEFAULT_PROJECT_OVERVIEW_LAYOUT, 333).nameWidth).toBe(333);
  });
});

describe('筛选与排序', () => {
  const now = new Date(2026, 10, 9, 15, 0);
  const rows = [
    row({ documentId: 'a', title: '行业报告', location: ['报告'], lastModifiedAt: now.getTime() - 60_000 }),
    row({ documentId: 'b', title: '访谈纪要', location: ['资料', '访谈'], nodeType: 'canvas', lastModifiedAt: new Date(2026, 10, 1).getTime() }),
    row({ documentId: 'c', title: '目标', location: [], lastModifiedAt: new Date(2026, 9, 1).getTime() }),
  ];

  it('类型、时间、位置与搜索取交集；搜索同时看名称和正文命中', () => {
    const filter = (filters: Partial<typeof EMPTY_PROJECT_OVERVIEW_FILTERS>, contentMatches: ReadonlySet<string> | null = null) =>
      filterProjectOverviewRows(rows, { ...EMPTY_PROJECT_OVERVIEW_FILTERS, ...filters }, { now, contentMatches })
        .map(item => item.documentId);
    expect(filter({ nodeType: 'canvas' })).toEqual(['b']);
    expect(filter({ modified: 'today' })).toEqual(['a']);
    expect(filter({ modified: 'week' })).toEqual(['a']);
    expect(filter({ modified: 'month' })).toEqual(['a', 'b']);
    expect(filter({ location: ['资料'] })).toEqual(['b']);
    expect(filter({ location: [] })).toEqual(['c']);
    expect(filter({ query: '报告' })).toEqual(['a']);
    expect(filter({ query: '储能' }, new Set(['c']))).toEqual(['c']);
    expect(filter({ query: '储能', location: ['报告'] }, new Set(['c']))).toEqual([]);
  });

  it('标签筛选要求同时带有；标签选项按名称去重', () => {
    const paper = { id: 't1', name: '论文' };
    const unread = { id: 't2', name: '待读' };
    const tagged = [
      row({ documentId: 'p', tags: [paper, unread] }),
      row({ documentId: 'q', tags: [paper] }),
      row({ documentId: 'r' }),
    ];
    const filter = (tags: string[]) => filterProjectOverviewRows(tagged, { ...EMPTY_PROJECT_OVERVIEW_FILTERS, tags }, { now, contentMatches: null })
      .map(item => item.documentId);
    expect(filter(['t1'])).toEqual(['p', 'q']);
    expect(filter(['t1', 't2'])).toEqual(['p']);
    expect(listProjectOverviewTags(tagged).map(tag => tag.name)).toEqual(['待读', '论文']);
  });

  it('“今天”从本地零点算，“最近 7 天”含今天', () => {
    expect(modifiedRangeStart('today', now)).toBe(new Date(2026, 10, 9).getTime());
    expect(modifiedRangeStart('week', now)).toBe(new Date(2026, 10, 3).getTime());
  });

  it('位置列出所有出现过文档的文件夹及其上级', () => {
    expect(listProjectOverviewLocations(rows)).toEqual([['报告'], ['资料'], ['资料', '访谈']]);
  });

  it('按最近修改倒序；空值不论升降序都排在最后', () => {
    const labels = { typeLabel: (type: string) => type, sourceLabel: () => '' };
    expect(sortProjectOverviewRows(rows, { key: 'modified', direction: 'desc' }, labels).map(item => item.documentId))
      .toEqual(['a', 'b', 'c']);
    const withPending = [
      row({ documentId: 'x', pendingRevisionCount: 2 }),
      row({ documentId: 'y', pendingRevisionCount: null }),
      row({ documentId: 'z', pendingRevisionCount: 5 }),
    ];
    expect(sortProjectOverviewRows(withPending, { key: 'pending', direction: 'desc' }, labels).map(item => item.documentId))
      .toEqual(['z', 'x', 'y']);
    expect(sortProjectOverviewRows(withPending, { key: 'pending', direction: 'asc' }, labels).map(item => item.documentId))
      .toEqual(['x', 'z', 'y']);
  });
});

describe('来源排序', () => {
  it('先按来源类别（Agent、子任务、Linnya CLI、插件、用户），同为 Agent 再按显示名，空值最后', () => {
    const agents = new Map([['decision_agent', 'Decision'], ['research_v1', 'Research']]);
    const labels = {
      typeLabel: (type: string) => type,
      sourceLabel: (item: ProjectOverviewRow) => (item.creatorActor === 'run'
        ? resolveProjectOverviewAgentName(item.creatorAgentId, agents, message)
        : item.creatorActor ?? ''),
    };
    const rows = [
      row({ documentId: 'user', creatorActor: 'user' }),
      row({ documentId: 'none' }),
      row({ documentId: 'research', creatorActor: 'run', creatorAgentId: 'research_v1' }),
      row({ documentId: 'cli', creatorActor: 'external' }),
      row({ documentId: 'subtask', creatorActor: 'subrun', creatorAgentId: 'subagent_document_editor' }),
      row({ documentId: 'default', creatorActor: 'run', creatorAgentId: null }),
      row({ documentId: 'decision', creatorActor: 'run', creatorAgentId: 'decision_agent' }),
    ];
    expect(sortProjectOverviewRows(rows, { key: 'source', direction: 'asc' }, labels).map(item => item.documentId))
      .toEqual(['decision', 'default', 'research', 'subtask', 'cli', 'user', 'none']);
    expect(sortProjectOverviewRows(rows, { key: 'source', direction: 'desc' }, labels).map(item => item.documentId))
      .toEqual(['user', 'cli', 'subtask', 'research', 'default', 'decision', 'none']);
  });
});

describe('展示文案', () => {
  it('Agent 显示名：默认 Agent 叫 Linnya Agent，其他用注册表名，查不到显示 ID，不再出现 Linnya AI', () => {
    const agents = new Map([['research_v1', 'Research']]);
    expect(resolveProjectOverviewAgentName(null, agents, message)).toBe('Linnya Agent');
    expect(resolveProjectOverviewAgentName('research_v1', agents, message)).toBe('Research');
    expect(resolveProjectOverviewAgentName('removed_agent', agents, message)).toBe('removed_agent');
  });

  it('来源：主运行显示具体 Agent，子运行显示子任务；用户、Linnya CLI；插件用插件名', () => {
    expect(formatProjectOverviewActor('run', { pluginName: null, agentName: 'Linnya Agent' }, message)).toBe('Linnya Agent');
    expect(formatProjectOverviewActor('run', { pluginName: null, agentName: 'Research' }, message)).toBe('Research');
    expect(formatProjectOverviewActor('subrun', { pluginName: null, agentName: 'subagent_document_editor' }, message)).toBe('子任务');
    expect(formatProjectOverviewActor('user', { pluginName: null, agentName: '' }, message)).toBe('用户');
    expect(formatProjectOverviewActor('external', { pluginName: null, agentName: '' }, message)).toBe('Linnya CLI');
    expect(formatProjectOverviewActor('plugin', { pluginName: 'Slides', agentName: '' }, message)).toBe('Slides');
    expect(formatProjectOverviewActor('plugin', { pluginName: null, agentName: '' }, message)).toBe('插件');
  });
});
