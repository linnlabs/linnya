import type { DocumentVersionSummary } from '@app/schemas';
import type { DocumentVersionRetentionPlan } from '../definitions/versionSelection';
import { selectDocumentHistory } from './selectDocumentHistory';

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
  return {
    keepVersionIds: rows.filter(row => keep.has(row.versionId)).map(row => row.versionId),
    removeVersionIds: rows.filter(row => !keep.has(row.versionId)).map(row => row.versionId),
  };
}
