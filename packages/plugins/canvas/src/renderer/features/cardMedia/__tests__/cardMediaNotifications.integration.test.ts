// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import type { WorkspaceMutationEvent } from '@app/schemas';
import { CanvasDocumentCardSchema } from '@plugin/canvas/shared';
import { createCanvasCardContent, type CanvasCardMediaPort } from '..';

afterEach(() => vi.unstubAllGlobals());
function fixture() {
  let next = 0, mutation: ((event: WorkspaceMutationEvent) => void) | undefined;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++next, callback); return next; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const cards = Array.from({ length: 12 }, (_, index) => CanvasDocumentCardSchema.parse({
    id: `c${index + 1}`, type: 'document', schemaVersion: 1, revision: 1, order: `a${index}`, color: 'white', locked: false,
    createdBy: { kind: 'user', conversationId: null, runId: null }, updatedBy: { kind: 'user', conversationId: null, runId: null },
    createdAt: 1, updatedAt: 1, x: 0, y: 0, width: 320, height: 240, parentId: null, data: { documentId: `doc${index}` },
  }));
  const preview = vi.fn<CanvasCardMediaPort['preview']>(async ({ documentId }) => ({ documentId, title: documentId, nodeType: 'markdown', status: 'ready', content: { revisionKey: '1', summary: '摘要' } }));
  const port: CanvasCardMediaPort = { preview, reference: async documentId => ({ documentId, status: 'available', title: documentId, nodeType: 'markdown', path: `workspace:/${documentId}.md` }),
    projectId: () => 'project', readImage: vi.fn(), openDocument: vi.fn(), subscribe: listener => { mutation = listener; return () => { mutation = undefined; }; }, subscribeAvailability: () => () => {} };
  const content = createCanvasCardContent('canvas', port), notified = vi.fn(); content.subscribe(notified);
  return { cards, content, preview, notified, frames,
    flush() { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(0); },
    rename() { mutation?.({ type: 'workspace.node.renamed', nodeId: 'doc0', projectId: 'project', mutationId: 'rename', nodeType: 'markdown', parentId: null, name: '新名', oldName: 'doc0' }); },
  };
}

it('整批身份与预览独立完成，只合并显示通知，并在关闭时取消迟到通知', async () => {
  const f = fixture();
  try {
    await f.content.refreshReferences(f.cards); f.content.refreshVisible(f.cards);
    await vi.waitFor(() => expect(f.preview).toHaveBeenCalledTimes(12));
    expect(f.content.documentTitles().size).toBe(12); expect(f.notified).not.toHaveBeenCalled(); expect(f.frames.size).toBe(1);
    f.flush(); expect(f.notified).toHaveBeenCalledExactlyOnceWith(null);
    f.rename(); await f.content.refreshReferences(f.cards); expect(f.frames.size).toBe(1);
    const count = f.notified.mock.calls.length; f.content.dispose(); f.flush(); expect(f.notified).toHaveBeenCalledTimes(count);
  } finally { f.content.dispose(); }
});

it('身份失效立即清除旧显示，资源错误也不等待成功通知的下一帧', async () => {
  const f = fixture();
  try {
    await f.content.refreshReferences(f.cards);
    expect(f.notified).not.toHaveBeenCalled();
    f.rename();
    expect(f.notified).toHaveBeenCalledExactlyOnceWith(null); expect(f.content.documentTitles().has('doc0')).toBe(false);
    expect(f.frames.size).toBe(0);
    await f.content.refreshReferences(f.cards);
    const error = new Error('preview unavailable'); f.preview.mockRejectedValueOnce(error);
    f.content.refreshVisible(f.cards);
    await vi.waitFor(() => expect(f.notified).toHaveBeenCalledWith(error));
    expect(f.frames.size).toBe(1);
  } finally { f.content.dispose(); }
});
