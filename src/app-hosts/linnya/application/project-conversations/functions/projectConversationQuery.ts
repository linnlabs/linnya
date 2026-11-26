import {
  projectConversationActorIds,
  toReadModelAgentId,
  type ProjectConversationQueryOptions,
  type ProjectConversationRow,
} from '@app/schemas';

/** 与文件页相同的本地日历日窗口：今天、含今天的七天/三十天。 */
function activityRangeStart(range: ProjectConversationQueryOptions['activity'], now: Date): number | null {
  if (range === 'any') return null;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range !== 'today') start.setDate(start.getDate() - (range === 'week' ? 6 : 29));
  return start.getTime();
}

export function filterProjectConversations(
  rows: readonly ProjectConversationRow[], options: ProjectConversationQueryOptions, now: Date,
): ProjectConversationRow[] {
  const start = activityRangeStart(options.activity, now);
  // 筛选值与 CLI 输出的 agents 一致：默认 Agent 写作 default（行里按读取合同为 null），
  // Linnya CLI 创建的对话写作入口值 linnya_cli；两者与注册表 Agent 同属 `projectConversationActorIds` 的取值。
  const agent = options.agent === null ? undefined : toReadModelAgentId(options.agent);
  return rows.filter(row => (agent === undefined || projectConversationActorIds(row).includes(agent))
    && (start === null || row.last_event_at >= start)
    && (options.documents !== 'changed' || row.changed_document_count > 0)
    && (options.documents !== 'unchanged' || row.changed_document_count === 0));
}

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

/** 置顶先分组；未测量占用始终排组内最后，稳定 tie-break 不随入口改变。 */
export function sortProjectConversations(
  rows: readonly ProjectConversationRow[], options: ProjectConversationQueryOptions,
): ProjectConversationRow[] {
  const direction = options.direction === 'asc' ? 1 : -1;
  const value = (row: ProjectConversationRow): string | number | null => {
    switch (options.sort) {
      case 'title': return row.title.trim();
      case 'turns': return row.turn_count;
      case 'documents': return row.changed_document_count;
      case 'activity': return row.last_event_at;
      case 'storage': return row.storage === null ? null
        : row.storage.record_bytes + row.storage.attachment_bytes + (row.storage.work_file_bytes ?? 0);
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
        ? collator.compare(String(a), String(b)) : a - b;
      if (compared !== 0) return compared * direction;
    }
    return right.last_event_at - left.last_event_at || left.conversation_id.localeCompare(right.conversation_id);
  });
}
