import type { DocumentVersionSummary } from '@app/schemas';
import type { DocumentHistorySelection } from '../definitions/versionSelection';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** 输入是经过 DocumentVersionListSchema 接纳的降序快照。 */
export function selectDocumentHistory(rows: readonly DocumentVersionSummary[]): DocumentHistorySelection {
  const current = rows[0];
  if (!current) return { recent: [], earlier: [] };

  const selected = new Set(rows.slice(0, 5).map(row => row.versionId));
  const addAnchors = (ages: readonly number[]): void => {
    for (const age of ages) {
      const targetTime = current.createdAt - age;
      // order 是提交顺序；时间相同按 order 决定，时钟回拨也不改变版本身份。
      const match = rows.reduce<DocumentVersionSummary | undefined>((best, row) => {
        if (row.createdAt > targetTime) return best;
        return !best || row.createdAt > best.createdAt ? row : best;
      }, undefined);
      if (match) selected.add(match.versionId);
    }
  };

  addAnchors([30 * MINUTE, 2 * 60 * MINUTE, DAY]);
  const recent = rows.filter(row => selected.has(row.versionId));
  const recentIds = new Set(selected);
  addAnchors([7 * DAY, 30 * DAY]);
  return {
    recent,
    earlier: rows.filter(row => selected.has(row.versionId) && !recentIds.has(row.versionId)),
  };
}
