import { describe, expect, it } from 'vitest';
import { planDocumentVersionRetention } from './planDocumentVersionRetention';

const rows = Array.from({ length: 9 }, (_, index) => ({ versionId: `v${9 - index}`, order: 9 - index,
  createdAt: Date.UTC(2026, 0, 9 - index), isCurrent: index === 0 }));
const versionBytes = rows.map(row => ({ versionId: row.versionId, byteLength: 100 }));

describe('文档历史的可选字节预算', () => {
  it('预算从最旧版本删起，最近五版即使超预算仍可恢复', () => {
    const normal = planDocumentVersionRetention(rows);
    expect(normal.keepVersionIds).toContain('v1');
    const capped = planDocumentVersionRetention(rows, { budgetBytes: 650, versionBytes });
    expect(capped.keepVersionIds).toEqual(['v9', 'v8', 'v7', 'v6', 'v5', 'v4']);
    expect(capped.removeVersionIds).toEqual(['v3', 'v2', 'v1']);
    const soft = planDocumentVersionRetention(rows, { budgetBytes: 100, versionBytes });
    expect(soft.keepVersionIds).toEqual(['v9', 'v8', 'v7', 'v6', 'v5']);
    expect(soft.overBudgetBytes).toBe(400);
    expect(planDocumentVersionRetention(rows)).toEqual(normal);
  });

  it('拒绝缺失与无效字节统计，避免把未知占用默认为零', () => {
    expect(() => planDocumentVersionRetention(rows, { budgetBytes: 200, versionBytes: [] })).toThrow('缺少');
    expect(() => planDocumentVersionRetention(rows, { budgetBytes: -1, versionBytes })).toThrow('非负');
    expect(() => planDocumentVersionRetention(rows, { budgetBytes: 200, versionBytes: [...versionBytes, versionBytes[0]] })).toThrow('重复');
  });
});
