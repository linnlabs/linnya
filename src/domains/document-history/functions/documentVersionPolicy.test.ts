import { describe, expect, it } from 'vitest';
import { DocumentVersionListSchema, type DocumentVersionSummary } from '@app/schemas';
import { selectDocumentHistory } from './selectDocumentHistory';
import { planDocumentVersionRetention } from './planDocumentVersionRetention';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const start = Date.UTC(2026, 0, 1);

function version(order: number, createdAt: number, isCurrent = false): DocumentVersionSummary {
  return { versionId: `version-${order}`, order, createdAt, isCurrent };
}

describe('文档历史展示与保留', () => {
  it('按真实时间选锚点，稀疏 order、同毫秒提交和缺席锚点不会伪造版本', () => {
    const rows = DocumentVersionListSchema.parse([
      version(100, start + 3 * DAY, true),
      version(97, start + 3 * DAY),
      version(89, start + 3 * DAY),
      version(80, start + 3 * DAY - MINUTE),
      version(74, start + 3 * DAY - 2 * MINUTE),
      version(63, start + 3 * DAY - 47 * MINUTE),
      version(30, start + 3 * DAY - 3 * 60 * MINUTE),
      version(1, start),
    ]);
    const selection = selectDocumentHistory(rows);
    expect(selection.recent).toEqual(rows);
    expect(selection.earlier).toEqual([]);
    expect(selectDocumentHistory(rows.slice(0, 2)).recent).toEqual(rows.slice(0, 2));
    expect(selectDocumentHistory([])).toEqual({ recent: [], earlier: [] });
  });

  it('时间回拨时仍以 order 表示当前版本，锚点按真实时间选择', () => {
    const rows = DocumentVersionListSchema.parse([
      version(9, start + 40 * DAY, true),
      version(8, start + 41 * DAY),
      version(7, start + 39 * DAY),
      version(6, start + 38 * DAY),
      version(5, start + 37 * DAY),
      version(4, start + 10 * DAY),
      version(3, start + 9 * DAY),
      version(2, start + 33 * DAY),
      version(1, start),
    ]);
    expect(selectDocumentHistory(rows).earlier.map(row => row.order)).toEqual([4, 2]);
    expect(planDocumentVersionRetention(rows).keepVersionIds).toContain('version-9');
  });

  it('连续保存并逐次清理之后，较早锚点仍有代表，且列表不等于物理保留集', () => {
    let kept: DocumentVersionSummary[] = [];
    for (let order = 1; order <= 181; order += 1) {
      const rows = DocumentVersionListSchema.parse([
        version(order, start + (order - 1) * MINUTE, true),
        ...kept.map(row => ({ ...row, isCurrent: false })),
      ]);
      const plan = planDocumentVersionRetention(rows);
      kept = rows.filter(row => plan.keepVersionIds.includes(row.versionId));
      expect(kept[0].order).toBe(order);
      expect(kept[kept.length - 1]?.order).toBe(1);
      expect(planDocumentVersionRetention(kept).removeVersionIds).toEqual([]);
    }
    const selection = selectDocumentHistory(kept);
    expect(selection.recent.length).toBeLessThanOrEqual(8);
    expect(kept.length).toBeGreaterThan(selection.recent.length);
    for (const age of [30 * MINUTE, 120 * MINUTE]) {
      const target = kept[0].createdAt - age;
      const candidate = selection.recent.find(row => row.createdAt <= target);
      expect(candidate).toBeDefined();
      expect(target - candidate!.createdAt).toBeLessThanOrEqual(5 * MINUTE);
    }
  });

  it('三个月持续编辑后保持有界，并能提供一天、一周、一月前恢复点', () => {
    let kept: DocumentVersionSummary[] = [];
    for (let order = 1; order <= 90 * 24; order += 1) {
      const rows = [
        version(order, start + order * 60 * MINUTE, true),
        ...kept.map(row => ({ ...row, isCurrent: false })),
      ];
      const plan = planDocumentVersionRetention(rows);
      kept = rows.filter(row => plan.keepVersionIds.includes(row.versionId));
      // 稠密桶、五个展示锚点及最近/最早强保留的保守总界，不锁死某次结果数量。
      expect(kept.length).toBeLessThanOrEqual(120);
    }
    const selection = selectDocumentHistory(kept);
    expect(selection.earlier).toHaveLength(2);
    const all = [...selection.recent, ...selection.earlier];
    for (const age of [DAY, 7 * DAY, 30 * DAY]) {
      const target = kept[0].createdAt - age;
      const candidate = all.find(row => row.createdAt <= target);
      expect(candidate).toBeDefined();
      expect(target - candidate!.createdAt).toBeLessThanOrEqual(DAY);
    }
    expect(new Set(all.map(row => row.versionId)).size).toBe(all.length);
  });

  it('拒绝同一快照中的重复身份、倒序错误和错误 current，避免错误保留或覆盖', () => {
    expect(() => DocumentVersionListSchema.parse([version(2, start), version(1, start)])).toThrow();
    expect(() => DocumentVersionListSchema.parse([
      version(2, start, true), { ...version(1, start), versionId: 'version-2' },
    ])).toThrow();
    expect(() => DocumentVersionListSchema.parse([version(1, start, true), version(2, start)])).toThrow();
  });
});
