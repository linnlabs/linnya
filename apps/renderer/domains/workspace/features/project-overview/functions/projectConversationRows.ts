import type { ProjectConversationRow, ProjectConversationStorage } from '@app/schemas';
import type {
  ProjectConversationColumnId,
  ProjectConversationFilters,
  ProjectConversationSort,
} from '../definitions/projectConversations';
import { modifiedRangeStart } from './projectOverviewRows';

/** 对话占用的总字节。过程文件不可读时只计可读的部分。 */
export function projectConversationStorageBytes(storage: ProjectConversationStorage): number {
  return storage.record_bytes + storage.attachment_bytes + (storage.work_file_bytes ?? 0);
}

/** 全部对话都测过才给出总占用；还有没测完的返回 null。 */
export function projectConversationsTotalBytes(rows: readonly ProjectConversationRow[]): number | null {
  let total = 0;
  for (const row of rows) {
    if (row.storage === null) return null;
    total += projectConversationStorageBytes(row.storage);
  }
  return total;
}

export interface ProjectConversationFilterContext {
  readonly now: Date;
  /** 搜索命中的对话；没有搜索时为 null。 */
  readonly matches: ReadonlyMap<string, string | null> | null;
}

export function filterProjectConversationRows(
  rows: readonly ProjectConversationRow[],
  filters: ProjectConversationFilters,
  context: ProjectConversationFilterContext,
): ProjectConversationRow[] {
  const activityStart = modifiedRangeStart(filters.activity, context.now);
  return rows.filter(row => {
    if (context.matches !== null && !context.matches.has(row.conversation_id)) return false;
    if (filters.agent !== null && (row.agent_id ?? '') !== filters.agent) return false;
    if (activityStart !== null && row.last_event_at < activityStart) return false;
    if (filters.documents === 'changed' && row.changed_document_count === 0) return false;
    if (filters.documents === 'unchanged' && row.changed_document_count > 0) return false;
    return true;
  });
}

export interface ProjectConversationSortLabels {
  readonly title: (row: ProjectConversationRow) => string;
  readonly agent: (row: ProjectConversationRow) => string;
}

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

/**
 * 置顶的对话始终在前（与侧栏一致），各自组内按所选列排序。
 * 没测过占用的对话按占用排序时排在最后，与升降序无关。
 */
export function sortProjectConversationRows(
  rows: readonly ProjectConversationRow[],
  sort: ProjectConversationSort,
  labels: ProjectConversationSortLabels,
): ProjectConversationRow[] {
  const direction = sort.direction === 'asc' ? 1 : -1;
  const value = (row: ProjectConversationRow): string | number | null => {
    switch (sort.key) {
      case 'title': return labels.title(row);
      case 'agent': return labels.agent(row);
      case 'turns': return row.turn_count;
      case 'documents': return row.changed_document_count;
      case 'activity': return row.last_event_at;
      case 'storage': return row.storage === null ? null : projectConversationStorageBytes(row.storage);
    }
  };
  return [...rows].sort((left, right) => {
    if (left.is_pinned !== right.is_pinned) return left.is_pinned ? -1 : 1;
    const a = value(left);
    const b = value(right);
    if (a === null || b === null) {
      if (a !== b) return a === null ? 1 : -1;
    } else {
      const compared = typeof a === 'string' || typeof b === 'string'
        ? collator.compare(String(a), String(b))
        : a - b;
      if (compared !== 0) return compared * direction;
    }
    return right.last_event_at - left.last_event_at || left.conversation_id.localeCompare(right.conversation_id);
  });
}

/** 时间和数量默认从大到小，文字默认从小到大。 */
export function defaultProjectConversationSortDirection(key: ProjectConversationColumnId): 'asc' | 'desc' {
  return key === 'title' || key === 'agent' ? 'asc' : 'desc';
}

/** 测占用一次只发一小批，避免一次长查询占住 Backend。 */
export function chunkConversationIds(ids: readonly string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) chunks.push(ids.slice(index, index + size));
  return chunks;
}
