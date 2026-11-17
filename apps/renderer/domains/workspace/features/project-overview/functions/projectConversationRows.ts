import type { ProjectConversationRow, ProjectConversationStorage } from '@app/schemas';
import type {
  ProjectConversationColumnId,
} from '../definitions/projectConversations';

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

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

/** 本地化 Agent 名称属于 Renderer 展示；其余排序和全部筛选归 Host 查询。 */
export function sortProjectConversationsByAgentLabel(
  rows: readonly ProjectConversationRow[],
  direction: 'asc' | 'desc',
  label: (row: ProjectConversationRow) => string,
): ProjectConversationRow[] {
  return [...rows].sort((left, right) => {
    if (left.is_pinned !== right.is_pinned) return left.is_pinned ? -1 : 1;
    return collator.compare(label(left), label(right)) * (direction === 'asc' ? 1 : -1)
      || right.last_event_at - left.last_event_at || left.conversation_id.localeCompare(right.conversation_id);
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
