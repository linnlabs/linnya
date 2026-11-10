// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import type { WorkspaceMutationEvent } from '@app/schemas';
import { CanvasDocumentCardSchema } from '@plugin/canvas/shared';
import { createCanvasCardContent, type CanvasCardMediaPort } from '..';

afterEach(() => vi.useRealTimers());
function fixture() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let mutation: ((event: WorkspaceMutationEvent) => void) | undefined;
  const cards = Array.from({ length: 12 }, (_, index) => CanvasDocumentCardSchema.parse({
    id: `c${index + 1}`, type: 'document', schemaVersion: 1, revision: 1, order: `a${index}`, color: 'white', locked: false,
    createdBy: { kind: 'user', conversationId: null, runId: null }, updatedBy: { kind: 'user', conversationId: null, runId: null },
    createdAt: 1, updatedAt: 1, x: 0, y: 0, width: 320, height: 240, parentId: null, data: { documentId: `doc${index}` },
  }));
  const preview = vi.fn<CanvasCardMediaPort['preview']>(async ({ documentId }) => ({ documentId, title: documentId, nodeType: 'markdown', status: 'ready', content: { revisionKey: '1', summary: '摘要' } }));
  const port: CanvasCardMediaPort = { preview, reference: async documentId => ({ documentId, status: 'available', title: documentId, nodeType: 'markdown', path: `workspace:/${documentId}.md` }),
    projectId: () => 'project', readImage: vi.fn(), openDocument: vi.fn(), subscribe: listener => { mutation = listener; return () => { mutation = undefined; }; }, subscribeAvailability: () => () => {} };
  const content = createCanvasCardContent('canvas', port), notified = vi.fn(); content.subscribe(notified);
  return { cards, content, preview, notified,
    flush() { vi.advanceTimersToNextTimer(); },
    rename() { mutation?.({ type: 'workspace.node.renamed', nodeId: 'doc0', projectId: 'project', mutationId: 'rename', nodeType: 'markdown', parentId: null, name: '新名', oldName: 'doc0' }); },
  };
}

it('整批身份与预览独立完成，只合并显示通知，并在关闭时取消迟到通知', async () => {
  const f = fixture();
  try {
    await f.content.refreshReferences(f.cards); f.content.refreshVisible(f.cards);
    const surfaces = await Promise.all(f.cards.map(card => f.content.create(card, new AbortController().signal)));
    expect(f.preview).toHaveBeenCalledTimes(12); expect(surfaces).toHaveLength(12);
    expect(f.content.documentTitles().size).toBe(12); expect(f.notified).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(1);
    f.flush(); expect(f.notified).toHaveBeenCalledExactlyOnceWith(null);
    f.rename(); await f.content.refreshReferences(f.cards); expect(vi.getTimerCount()).toBe(1);
    const count = f.notified.mock.calls.length; f.content.dispose(); await vi.runAllTimersAsync(); expect(f.notified).toHaveBeenCalledTimes(count);
  } finally { f.content.dispose(); }
});

it('身份失效立即清除旧显示，资源错误也不等待成功通知工作批次', async () => {
  const f = fixture();
  try {
    await f.content.refreshReferences(f.cards);
    expect(f.notified).not.toHaveBeenCalled();
    f.rename();
    expect(f.notified).toHaveBeenCalledExactlyOnceWith(null); expect(f.content.documentTitles().has('doc0')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await f.content.refreshReferences(f.cards);
    const error = new Error('preview unavailable'); f.preview.mockRejectedValueOnce(error);
    f.content.refreshVisible(f.cards);
    await Promise.allSettled(f.cards.map(card => f.content.create(card, new AbortController().signal)));
    expect(f.notified).toHaveBeenCalledWith(error); expect(vi.getTimerCount()).toBe(1);
  } finally { f.content.dispose(); }
});
