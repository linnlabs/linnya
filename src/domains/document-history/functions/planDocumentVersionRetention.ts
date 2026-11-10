import type { DocumentVersionSummary } from '@app/schemas';
import type { DocumentVersionRetentionPlan } from '../definitions/versionSelection';
import { selectDocumentHistory } from './selectDocumentHistory';
import type { DocumentVersionRetentionBudget } from '@linnya/plugin-host-contract/backend/documentHistory';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * UI 的十个恢复点不是删除规则：现在尚未成为锚点的版本，稍后可能需要。
 * 固定 UTC 时间桶由细到粗保留代表，避免每次保存造成时间窗口整体平移。
 * 本函数只返回计划，不读取数据库、不删除载荷，也不处理插件的依赖链。
 */
export function planDocumentVersionRetention(
  rows: readonly DocumentVersionSummary[],
  budget?: DocumentVersionRetentionBudget,
): DocumentVersionRetentionPlan {
  const current = rows[0];
  const first = rows[rows.length - 1];
  if (!current || !first) return { keepVersionIds: [], removeVersionIds: [] };

  const selection = selectDocumentHistory(rows);
  const keep = new Set([
    first.versionId,
    ...selection.recent.map(row => row.versionId),
    ...selection.earlier.map(row => row.versionId),
  ]);
  const buckets = new Set<string>();
  for (const row of rows) {
    const age = current.createdAt - row.createdAt;
    const bucket = age <= 2 * HOUR
      ? `minute:${Math.floor(row.createdAt / (5 * MINUTE))}`
      : age <= 2 * DAY
        ? `hour:${Math.floor(row.createdAt / HOUR)}`
        : age <= 30 * DAY
          ? `day:${Math.floor(row.createdAt / DAY)}`
          : 'older';
    if (!buckets.has(bucket)) {
      buckets.add(bucket);
      keep.add(row.versionId);
    }
  }
  if (budget) return applyByteBudget(rows, keep, budget);
  return {
    keepVersionIds: rows.filter(row => keep.has(row.versionId)).map(row => row.versionId),
    removeVersionIds: rows.filter(row => !keep.has(row.versionId)).map(row => row.versionId),
  };
}

function applyByteBudget(
  rows: readonly DocumentVersionSummary[], keep: Set<string>, budget: DocumentVersionRetentionBudget,
): DocumentVersionRetentionPlan {
  if (!Number.isSafeInteger(budget.budgetBytes) || budget.budgetBytes < 0) throw new Error('历史预算必须是非负安全整数');
  const bytes = new Map<string, number>();
  for (const row of budget.versionBytes) {
    if (bytes.has(row.versionId) || !Number.isSafeInteger(row.byteLength) || row.byteLength < 0) throw new Error('历史字节统计无效或重复');
    bytes.set(row.versionId, row.byteLength);
  }
  const recent = new Set(rows.slice(0, 5).map(row => row.versionId));
  let total = 0;
  for (const row of rows) {
    const size = bytes.get(row.versionId);
    if (size === undefined) throw new Error(`历史字节统计缺少版本 ${row.versionId}`);
    if (recent.has(row.versionId)) keep.add(row.versionId);
    if (keep.has(row.versionId)) total += size;
  }
  for (let index = rows.length - 1; index >= 0 && total > budget.budgetBytes; index -= 1) {
    const row = rows[index];
    if (row && keep.has(row.versionId) && !recent.has(row.versionId)) {
      keep.delete(row.versionId);
      total -= bytes.get(row.versionId) ?? 0;
    }
  }
  return {
    keepVersionIds: rows.filter(row => keep.has(row.versionId)).map(row => row.versionId),
    removeVersionIds: rows.filter(row => !keep.has(row.versionId)).map(row => row.versionId),
    overBudgetBytes: Math.max(0, total - budget.budgetBytes),
  };
}
