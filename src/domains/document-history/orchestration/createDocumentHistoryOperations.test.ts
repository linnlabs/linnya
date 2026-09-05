import { describe, expect, it, vi } from 'vitest';
import type { DocumentVersionSummary } from '@app/schemas';
import { DocumentHistoryError } from '@linnya/plugin-host-contract/backend/documentHistory';
import { createDocumentHistoryOperations } from './createDocumentHistoryOperations';

describe('文档历史操作（不依赖任何插件）', () => {
  it('选择恢复点、校验并发基线，恢复生成新版本', async () => {
    let rows: DocumentVersionSummary[] = Array.from({ length: 40 }, (_, i) => ({
      versionId: `v${40 - i}`, order: 40 - i, createdAt: (40 - i) * 60_000, isCurrent: i === 0,
    }));
    const reportFailure = vi.fn();
    const runtime = createDocumentHistoryOperations({
      context: {}, reportFailure,
      resolve: () => ({
        list: () => rows,
        async restore(request) {
          if (request.expectedCurrentVersionId !== rows[0].versionId) throw new DocumentHistoryError('version_conflict');
          const current = { versionId: 'restored', order: 41, createdAt: 41 * 60_000, isCurrent: true };
          rows = [current, ...rows.map(row => ({ ...row, isCurrent: false }))];
          return current;
        },
      }),
    });
    const listed = await runtime.list('doc');
    expect(listed.success && listed.recent.map(row => row.versionId)).toEqual(['v40', 'v39', 'v38', 'v37', 'v36', 'v10']);
    expect(await runtime.restore({ documentId: 'doc', versionId: 'v10', expectedCurrentVersionId: 'v39' })).toEqual({ success: false, code: 'version_conflict' });
    expect(rows[0].versionId).toBe('v40');
    expect(await runtime.restore({ documentId: 'doc', versionId: 'v10', expectedCurrentVersionId: 'v40' })).toMatchObject({ success: true, current: { versionId: 'restored', order: 41 } });
    expect(rows.find(row => row.versionId === 'v10')).toBeDefined();
    expect(reportFailure).toHaveBeenCalledTimes(1);
  });

  it('缺失或停用的 provider 拒绝操作，不转发到其他文档', async () => {
    const runtime = createDocumentHistoryOperations({ context: {}, reportFailure: vi.fn(), resolve: () => { throw new DocumentHistoryError('history_unavailable'); } });
    expect(await runtime.list('doc')).toEqual({ success: false, code: 'history_unavailable' });
    expect(await runtime.restore({ documentId: 'doc', versionId: 'v1', expectedCurrentVersionId: 'v2' })).toEqual({ success: false, code: 'history_unavailable' });
  });
});
