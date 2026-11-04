import { expect, it, vi } from 'vitest';
import { CanvasDocumentCardSchema } from '@plugin/canvas/shared';
import type { CanvasCardMediaPort } from '../definitions/cardMedia';
import { createCanvasDocumentPreviews } from '../orchestration/createCanvasDocumentPreviews';

it('超过结果缓存容量时，单个目标变代不重读稳定前缀，后续文档仍能取得预览', async () => {
  const cards = Array.from({ length: 200 }, (_, index) => CanvasDocumentCardSchema.parse({
    id: `c${index + 1}`, type: 'document', schemaVersion: 1, revision: 1, order: `a${index}`, color: 'white', locked: false,
    createdBy: { kind: 'user', conversationId: null, runId: null }, updatedBy: { kind: 'user', conversationId: null, runId: null },
    createdAt: 1, updatedAt: 1, x: 0, y: 0, width: 320, height: 240, parentId: null, data: { documentId: `doc${index}` },
  }));
  const versions = new Map<string, number>(), counts = new Map<string, number>();
  const preview = vi.fn<CanvasCardMediaPort['preview']>(async input => {
    counts.set(input.documentId, (counts.get(input.documentId) ?? 0) + 1);
    // 模拟搜索身份分批返回：前缀已超过128项缓存，后面一张卡此时获得新世代。
    if (input.documentId === 'doc149') versions.set('doc199', 1);
    return { documentId: input.documentId, title: input.documentId, nodeType: 'markdown', status: 'ready',
      content: { revisionKey: String(versions.get(input.documentId) ?? 0), overview: 'thumbnail', summary: '已授权摘要' } };
  });
  const port: CanvasCardMediaPort = { preview, projectId: () => 'project', reference: vi.fn(), readImage: vi.fn(),
    subscribe: () => () => {}, subscribeAvailability: () => () => {}, openDocument: vi.fn() };
  const previews = createCanvasDocumentPreviews(port, id => versions.get(id) ?? 0, () => previews.refreshVisible(cards));
  try {
    previews.refreshVisible(cards);
    await vi.waitFor(() => expect(counts.size).toBe(200));
    expect(preview).toHaveBeenCalledTimes(200);
    expect([...counts.values()]).toEqual(Array.from({ length: 200 }, () => 1));
    versions.set('doc199', 2); previews.refreshVisible(cards);
    await vi.waitFor(() => expect(counts.get('doc199')).toBe(2));
    expect(preview).toHaveBeenCalledTimes(201);
  } finally { previews.dispose(); }
});
