import { expect, it, vi } from 'vitest';
import { CanvasDocumentCardSchema } from '@plugin/canvas/shared';
import type { CanvasCardMediaPort } from '../definitions/cardMedia';
import { createCanvasDocumentPreviews } from '../orchestration/createCanvasDocumentPreviews';
it('封面缓存把只读全文计入32MiB预算，淘汰旧全文后按需重新读取', async () => {
  const preview = vi.fn<CanvasCardMediaPort['preview']>(async input => ({ documentId: input.documentId, title: '文档', nodeType: 'markdown', status: 'ready', content: { revisionKey: '1', summary: '摘要', detail: { format: 'markdown', text: '字'.repeat(1_000_000) } } }));
  const port: CanvasCardMediaPort = { preview, projectId: () => 'project', reference: vi.fn(), readImage: vi.fn(), subscribe: () => () => {}, subscribeAvailability: () => () => {}, openDocument: vi.fn() };
  const previews = createCanvasDocumentPreviews(port, () => 0, () => {});
  const cards = Array.from({ length: 17 }, (_, index) => CanvasDocumentCardSchema.parse({ id: `c${index + 1}`, type: 'document', schemaVersion: 1, revision: 1, order: 'a0', color: 'white', locked: false,
    createdBy: { kind: 'user', conversationId: null, runId: null }, updatedBy: { kind: 'user', conversationId: null, runId: null }, createdAt: 1, updatedAt: 1,
    x: 0, y: 0, width: 320, height: 240, parentId: null, data: { documentId: `doc${index}` } }));
  try {
    for (const card of cards) await previews.read(card);
    const first = cards[0]; if (!first) throw new Error('missing fixture');
    await previews.read(first); expect(preview).toHaveBeenCalledTimes(18);
  } finally { previews.dispose(); }
});
