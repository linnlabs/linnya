import type { ProjectOverviewActor, ProjectOverviewDocument } from '@app/schemas';
import type {
  ProjectOverviewFilters,
  ProjectOverviewModifiedRange,
  ProjectOverviewRow,
  ProjectOverviewSort,
} from '../definitions/projectOverview';

export function toProjectOverviewRow(document: ProjectOverviewDocument): ProjectOverviewRow {
  return {
    documentId: document.document_id,
    nodeType: document.node_type,
    title: document.title,
    parentId: document.parent_id,
    location: document.location,
    createdAt: document.created_at,
    creatorActor: document.creator?.actor ?? null,
    creatorPluginId: document.creator?.plugin_id ?? null,
    conversationId: document.creator?.conversation_id ?? null,
    conversationTitle: document.creator?.conversation_title ?? null,
    lastModifiedAt: document.last_modified_at,
    lastModifiedActor: document.last_modified_by?.actor ?? null,
    lastModifiedPluginId: document.last_modified_by?.plugin_id ?? null,
    pendingRevisionCount: document.pending_revision_count,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 修改时间范围的起点（含）；“今天”按本地日历日算。 */
export function modifiedRangeStart(range: ProjectOverviewModifiedRange, now: Date): number | null {
  if (range === 'any') return null;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (range === 'today') return startOfToday;
  return startOfToday - (range === 'week' ? 6 : 29) * DAY_MS;
}

function isInLocation(row: ProjectOverviewRow, location: readonly string[]): boolean {
  if (location.length === 0) return row.location.length === 0;
  return location.length <= row.location.length && location.every((name, index) => row.location[index] === name);
}

/**
 * 搜索同时匹配文件名和正文：名称包含关键词（不分大小写），或正文搜索命中这份文档。
 * 其他条件与搜索一起取交集。
 */
export function filterProjectOverviewRows(
  rows: readonly ProjectOverviewRow[],
  filters: ProjectOverviewFilters,
  options: { readonly now: Date; readonly contentMatches: ReadonlySet<string> | null },
): ProjectOverviewRow[] {
  const query = filters.query.trim().toLocaleLowerCase();
  const since = modifiedRangeStart(filters.modified, options.now);
  return rows.filter(row => {
    if (filters.nodeType !== null && row.nodeType !== filters.nodeType) return false;
    if (since !== null && row.lastModifiedAt < since) return false;
    if (filters.location !== null && !isInLocation(row, filters.location)) return false;
    if (query) {
      const nameMatches = row.title.toLocaleLowerCase().includes(query);
      if (!nameMatches && !options.contentMatches?.has(row.documentId)) return false;
    }
    return true;
  });
}

/** 项目里出现过文档的文件夹路径（含上级），按路径排好，供“位置”筛选。 */
export function listProjectOverviewLocations(rows: readonly ProjectOverviewRow[]): string[][] {
  const seen = new Map<string, string[]>();
  for (const row of rows) {
    for (let depth = 1; depth <= row.location.length; depth += 1) {
      const path = row.location.slice(0, depth);
      seen.set(path.join('\u0000'), path);
    }
  }
  return [...seen.values()].sort((left, right) => left.join('/').localeCompare(right.join('/'), 'zh-CN'));
}

const ACTOR_ORDER: Record<ProjectOverviewActor, number> = { linnya_ai: 0, external: 1, plugin: 2, user: 3 };

export interface ProjectOverviewSortLabels {
  readonly typeLabel: (nodeType: string) => string;
}

function compareNullable<T>(left: T | null, right: T | null, compare: (a: T, b: T) => number): number {
  if (left === null && right === null) return 0;
  // 空值始终排在最后，与升降序无关，由调用方在翻转前处理。
  if (left === null) return 1;
  if (right === null) return -1;
  return compare(left, right);
}

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

/** 排序稳定；同值按名称，再按文档身份兜底。空值不论升降序都排在最后。 */
export function sortProjectOverviewRows(
  rows: readonly ProjectOverviewRow[],
  sort: ProjectOverviewSort,
  labels: ProjectOverviewSortLabels,
): ProjectOverviewRow[] {
  const direction = sort.direction === 'asc' ? 1 : -1;
  const keyed = (row: ProjectOverviewRow): { value: string | number | null; text: boolean } => {
    switch (sort.key) {
      case 'name': return { value: row.title, text: true };
      case 'location': return { value: row.location.join('/'), text: true };
      case 'source': return { value: row.creatorActor === null ? null : ACTOR_ORDER[row.creatorActor], text: false };
      case 'conversation': return { value: row.conversationTitle, text: true };
      case 'modified': return { value: row.lastModifiedAt, text: false };
      case 'pending': return { value: row.pendingRevisionCount, text: false };
      case 'type': return { value: labels.typeLabel(row.nodeType), text: true };
      case 'created': return { value: row.createdAt, text: false };
    }
  };
  return [...rows].sort((left, right) => {
    const a = keyed(left);
    const b = keyed(right);
    const nullOrder = compareNullable(a.value, b.value, () => 0);
    if (a.value === null || b.value === null) {
      if (nullOrder !== 0) return nullOrder;
    } else {
      const compared = a.text
        ? collator.compare(String(a.value), String(b.value))
        : Number(a.value) - Number(b.value);
      if (compared !== 0) return compared * direction;
    }
    return collator.compare(left.title, right.title) || left.documentId.localeCompare(right.documentId);
  });
}
