import { formatAgentTimestamp } from '@app/schemas';
import type { ActionLedgerChangeList, ActionLedgerDocumentChange } from 'src/domains/action-ledger';

const coverage = '仅覆盖已接入入口的文档新建和更新。历史会精简；删除、移动、改名和其他未登记的操作无法从此查询判断。';
const notice = '结果超过条数或输出上限，只列出最近的一部分。可缩短日期范围。';

function projectChange(change: ActionLedgerDocumentChange, path: string | null) {
  return {
    path, documentId: change.documentId, actions: change.actions, actor: change.actorKind,
    ...(change.runId ? { runId: change.runId, rootRunId: change.rootRunId } : {}),
    ...(change.agentId ? { agent: change.agentId } : {}),
    ...(change.pluginId ? { pluginId: change.pluginId } : {}),
    entryCount: change.entryCount,
    firstRecordedAt: formatAgentTimestamp(change.firstRecordedAt),
    lastRecordedAt: formatAgentTimestamp(change.lastRecordedAt),
  };
}

/** 先给完整 JSON 与截断提示留出空间，避免 Shell 展示层把一条路径或整个 JSON 剪断。 */
export function formatDocumentChanges(
  result: ActionLedgerChangeList, resolvePath: (id: string) => string | null, maxCharacters: number,
): string {
  const changes: ReturnType<typeof projectChange>[] = [];
  let used = JSON.stringify({ truncated: true, notice, coverage, changes }).length + 1;
  let truncated = result.truncated;
  for (const change of result.changes) {
    const row = projectChange(change, resolvePath(change.documentId));
    used += JSON.stringify(row).length + (changes.length ? 1 : 0);
    if (used > maxCharacters) {
      truncated = true;
      break;
    }
    changes.push(row);
  }
  return JSON.stringify({ truncated, ...(truncated ? { notice } : {}), coverage, changes }) + '\n';
}
