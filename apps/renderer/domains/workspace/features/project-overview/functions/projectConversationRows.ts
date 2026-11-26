import {
  projectConversationActorIds,
  type ProjectConversationRow,
  type ProjectConversationStorage,
  type ProjectConversationSubagent,
} from '@app/schemas';
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

/** 筛选菜单里的执行者：这些对话里的发起入口和回复过的全部 Agent，默认 Agent 记为空字符串（与筛选值一致）。 */
export function projectConversationActorFilterValues(rows: readonly ProjectConversationRow[]): string[] {
  return [...new Set(rows.flatMap(row => projectConversationActorIds(row).map(actorId => actorId ?? '')))];
}

/** Agent 列的显示文字：发起入口在前，其后是回复过的 Agent（最近的在前）；两者都没有时为 null。 */
export function formatProjectConversationActors(
  row: Pick<ProjectConversationRow, 'origin' | 'replied_agent_ids'>,
  actorName: (actorId: string | null) => string,
  separator: string,
): string | null {
  const actorIds = projectConversationActorIds(row);
  return actorIds.length === 0 ? null : actorIds.map(actorName).join(separator);
}

/**
 * 对话派出的子任务总次数。子 Agent 还没有面向用户的名字，界面与文件来源一样统称“子任务”，
 * 不按 Agent 分列；合同里的逐 Agent 计数留给以后有了名字再用。
 */
export function projectConversationSubrunCount(subagents: readonly ProjectConversationSubagent[]): number {
  return subagents.reduce((total, item) => total + item.run_count, 0);
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
