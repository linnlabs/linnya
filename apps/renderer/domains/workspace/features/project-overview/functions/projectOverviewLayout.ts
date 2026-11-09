import {
  PROJECT_OVERVIEW_COLUMN_IDS,
  PROJECT_OVERVIEW_LAYOUT_VERSION,
  type ProjectOverviewColumnId,
  type ProjectOverviewColumnLayout,
  type ProjectOverviewLayout,
} from '../definitions/projectOverview';

export const PROJECT_OVERVIEW_MIN_COLUMN_WIDTH = 72;
export const PROJECT_OVERVIEW_MAX_COLUMN_WIDTH = 480;

const DEFAULT_COLUMNS: readonly ProjectOverviewColumnLayout[] = [
  { id: 'location', visible: true, width: 132 },
  { id: 'source', visible: true, width: 104 },
  { id: 'conversation', visible: true, width: 220 },
  { id: 'modified', visible: true, width: 168 },
  { id: 'pending', visible: true, width: 112 },
  { id: 'type', visible: false, width: 96 },
  { id: 'created', visible: false, width: 120 },
];

export const DEFAULT_PROJECT_OVERVIEW_LAYOUT: ProjectOverviewLayout = Object.freeze({
  version: PROJECT_OVERVIEW_LAYOUT_VERSION,
  columns: DEFAULT_COLUMNS,
});

function isColumnId(value: unknown): value is ProjectOverviewColumnId {
  return typeof value === 'string' && PROJECT_OVERVIEW_COLUMN_IDS.some(id => id === value);
}

export function clampColumnWidth(width: number): number {
  if (!Number.isFinite(width)) return PROJECT_OVERVIEW_MIN_COLUMN_WIDTH;
  return Math.round(Math.min(PROJECT_OVERVIEW_MAX_COLUMN_WIDTH, Math.max(PROJECT_OVERVIEW_MIN_COLUMN_WIDTH, width)));
}

function readSavedColumn(value: unknown): ProjectOverviewColumnLayout | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (!isColumnId(record.id) || typeof record.visible !== 'boolean' || typeof record.width !== 'number') return null;
  return { id: record.id, visible: record.visible, width: clampColumnWidth(record.width) };
}

/**
 * 读回保存的配置：版本不对或格式坏了就用默认；认不出的列丢掉，新加的列按默认位置补上，
 * 保证每一列恰好出现一次。
 */
export function normalizeProjectOverviewLayout(saved: unknown): ProjectOverviewLayout {
  if (!saved || typeof saved !== 'object') return DEFAULT_PROJECT_OVERVIEW_LAYOUT;
  const record = saved as Record<string, unknown>;
  if (record.version !== PROJECT_OVERVIEW_LAYOUT_VERSION || !Array.isArray(record.columns)) {
    return DEFAULT_PROJECT_OVERVIEW_LAYOUT;
  }
  const columns: ProjectOverviewColumnLayout[] = [];
  const seen = new Set<ProjectOverviewColumnId>();
  for (const value of record.columns) {
    const column = readSavedColumn(value);
    if (!column || seen.has(column.id)) continue;
    seen.add(column.id);
    columns.push(column);
  }
  DEFAULT_COLUMNS.forEach((column, defaultIndex) => {
    if (seen.has(column.id)) return;
    const before = DEFAULT_COLUMNS.slice(0, defaultIndex).map(item => item.id);
    const insertAt = columns.reduce((index, item, position) => (before.includes(item.id) ? position + 1 : index), 0);
    columns.splice(insertAt, 0, column);
  });
  return { version: PROJECT_OVERVIEW_LAYOUT_VERSION, columns };
}

export function toggleProjectOverviewColumn(layout: ProjectOverviewLayout, id: ProjectOverviewColumnId): ProjectOverviewLayout {
  return {
    ...layout,
    columns: layout.columns.map(column => (column.id === id ? { ...column, visible: !column.visible } : column)),
  };
}

/** 把一列移到另一列的位置；只在显示的列之间拖动，隐藏的列保持相对位置。 */
export function moveProjectOverviewColumn(
  layout: ProjectOverviewLayout,
  id: ProjectOverviewColumnId,
  targetId: ProjectOverviewColumnId,
): ProjectOverviewLayout {
  if (id === targetId) return layout;
  const columns = [...layout.columns];
  const from = columns.findIndex(column => column.id === id);
  const to = columns.findIndex(column => column.id === targetId);
  if (from < 0 || to < 0) return layout;
  const [moved] = columns.splice(from, 1);
  if (!moved) return layout;
  columns.splice(to, 0, moved);
  return { ...layout, columns };
}

export function resizeProjectOverviewColumn(
  layout: ProjectOverviewLayout,
  id: ProjectOverviewColumnId,
  width: number,
): ProjectOverviewLayout {
  return {
    ...layout,
    columns: layout.columns.map(column => (column.id === id ? { ...column, width: clampColumnWidth(width) } : column)),
  };
}
