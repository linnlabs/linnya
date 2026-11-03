import { expect, it, vi } from 'vitest';
import { CanvasTextCardSchema, createCanvasPlainTextDocument } from '@plugin/canvas/shared';
import { createCanvasCardOpening } from '../createCanvasCardOpening';

const card = CanvasTextCardSchema.parse({ id: 'c1', type: 'text', schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white', createdBy: { kind: 'user', conversationId: null, runId: null }, updatedBy: { kind: 'user', conversationId: null, runId: null }, createdAt: 0, updatedAt: 0, x: 300, y: 500, width: 280, height: 1800, parentId: null, data: { contentVersion: 1, content: createCanvasPlainTextDocument('长正文') } });
it('远景编辑先定位长卡顶部并等待精确位图，切换选择不接受迟到编辑请求', async () => {
  const setCamera = vi.fn(), openText = vi.fn(async () => {}), cameraChanged = vi.fn(), unavailable = vi.fn();
  let resolve!: (value: 'ready' | 'unavailable') => void;
  const prepare = vi.fn(() => new Promise<'ready' | 'unavailable'>(done => { resolve = done; }));
  const opening = createCanvasCardOpening({ kernel: { readCamera: () => ({ x: 0, y: 0, zoom: 0.1 }), setCamera }, readCard: () => card, finish: async () => true, cameraChanged, prepare, openText, openMedia: async () => {}, unavailable });
  const first = opening.open(card.id); await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
  expect(setCamera).toHaveBeenCalledWith({ x: -252, y: -404, zoom: 1 }); expect(cameraChanged).toHaveBeenCalledOnce(); expect(openText).not.toHaveBeenCalled();
  opening.cancel(); resolve('ready'); await first; expect(openText).not.toHaveBeenCalled();
  const second = opening.open(card.id); await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(2)); resolve('unavailable'); await second;
  expect(openText).toHaveBeenCalledExactlyOnceWith(card.id); expect(unavailable).toHaveBeenCalledOnce(); opening.dispose();
});
