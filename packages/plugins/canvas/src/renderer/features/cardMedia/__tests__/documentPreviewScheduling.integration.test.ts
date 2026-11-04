import { expect, it, vi } from 'vitest';
import type { DocumentPreviewResult } from '@app/schemas';
import { CanvasDocumentCardSchema } from '@plugin/canvas/shared';
import type { CanvasCardMediaPort } from '../definitions/cardMedia';
import { createCanvasDocumentPreviews } from '../orchestration/createCanvasDocumentPreviews';

function fixture(count = 6) {
  const cards = Array.from({ length: count }, (_, index) => CanvasDocumentCardSchema.parse({
    id: `c${index + 1}`, type: 'document', schemaVersion: 1, revision: 1, order: `a${index}`, color: 'white', locked: false,
    createdBy: { kind: 'user', conversationId: null, runId: null }, updatedBy: { kind: 'user', conversationId: null, runId: null },
    createdAt: 1, updatedAt: 1, x: 0, y: 0, width: 320, height: 240, parentId: null, data: { documentId: `doc${index}` },
  }));
  const requests: { documentId: string; resolve: (value: DocumentPreviewResult) => void }[] = [];
  let active = 0, peak = 0, generation = 0;
  const preview = vi.fn<CanvasCardMediaPort['preview']>(input => {
    active++; peak = Math.max(peak, active);
    return new Promise<DocumentPreviewResult>(resolve => requests.push({ documentId: input.documentId, resolve })).finally(() => { active--; });
  });
  const port: CanvasCardMediaPort = { preview, projectId: () => 'project', reference: vi.fn(), readImage: vi.fn(),
    subscribe: () => () => {}, subscribeAvailability: () => () => {}, openDocument: vi.fn() };
  const previews = createCanvasDocumentPreviews(port, { version: () => generation, generation: () => generation }, () => {});
  return { cards, previews, requests, preview, peak: () => peak, bump: () => { generation++; },
    complete(index: number, revision = generation) {
      const request = requests[index]; if (!request) throw new Error('missing request');
      request.resolve({ documentId: request.documentId, title: request.documentId, nodeType: 'markdown', status: 'ready', content: { revisionKey: String(revision), summary: '已授权摘要' } });
    },
  };
}

it('预读与显式正文共用4槽，按需读取先于尚未发送的预读目标', async () => {
  const f = fixture();
  try {
    f.previews.refreshVisible(f.cards);
    await vi.waitFor(() => expect(f.requests).toHaveLength(4));
    const target = f.cards[5]; if (!target) throw new Error('missing card');
    const foreground = f.previews.read(target);
    await Promise.resolve(); expect(f.requests).toHaveLength(4);
    f.complete(0);
    await vi.waitFor(() => expect(f.requests).toHaveLength(5));
    expect(f.requests[4]?.documentId).toBe('doc5');
    for (let index = 1; index <= 4; index++) f.complete(index);
    await foreground;
    await vi.waitFor(() => expect(f.requests).toHaveLength(6)); f.complete(5);
    await Promise.all(f.cards.map(card => f.previews.read(card)));
    expect(f.peak()).toBe(4); expect(f.preview).toHaveBeenCalledTimes(6);
  } finally { f.previews.dispose(); }
});

it('4个在途旧身份同时变代时，先释放传输槽再重读，不会各自等待新请求而死锁', async () => {
  const f = fixture(4);
  try {
    const reads = f.cards.map(card => f.previews.read(card));
    await vi.waitFor(() => expect(f.requests).toHaveLength(4));
    f.bump(); f.previews.refreshVisible(f.cards);
    for (let index = 0; index < 4; index++) f.complete(index, 0);
    await vi.waitFor(() => expect(f.requests).toHaveLength(8));
    for (let index = 4; index < 8; index++) f.complete(index, 1);
    expect((await Promise.all(reads)).map(result => result.content?.revisionKey)).toEqual(['1', '1', '1', '1']);
    expect(f.peak()).toBe(4);
  } finally { f.previews.dispose(); }
});

it('关闭后拒绝尚未发送的按需读取，在途结果也不发布旧内容', async () => {
  const f = fixture(5);
  const completed = Promise.allSettled(f.cards.map(card => f.previews.read(card)));
  await vi.waitFor(() => expect(f.requests).toHaveLength(4));
  f.previews.dispose();
  for (let index = 0; index < 4; index++) f.complete(index);
  const results = await completed;
  expect(results.every(result => result.status === 'rejected' && result.reason instanceof DOMException && result.reason.name === 'AbortError')).toBe(true);
  expect(f.preview).toHaveBeenCalledTimes(4); expect(f.peak()).toBe(4);
});
