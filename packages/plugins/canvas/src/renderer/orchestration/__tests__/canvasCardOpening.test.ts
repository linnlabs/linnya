import { expect, it, vi } from 'vitest';
import { CanvasTextCardSchema, createCanvasPlainTextDocument } from '@plugin/canvas/shared';
import { createCanvasCardOpening } from '../createCanvasCardOpening';

const card = CanvasTextCardSchema.parse({ id: 'c1', type: 'text', schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white', createdBy: { kind: 'user', conversationId: null, runId: null }, updatedBy: { kind: 'user', conversationId: null, runId: null }, createdAt: 0, updatedAt: 0, x: 300, y: 500, width: 280, height: 1800, parentId: null, data: { contentVersion: 1, content: createCanvasPlainTextDocument('长正文') } });
it('远景编辑先定位长卡顶部并等待精确位图，切换选择不接受迟到编辑请求', async () => {
  const setCamera = vi.fn(), openText = vi.fn(async () => {}), cameraChanged = vi.fn(), unavailable = vi.fn(), finishTransitions = vi.fn();
  let resolve!: (value: 'ready' | 'unavailable') => void;
  const prepare = vi.fn(() => new Promise<'ready' | 'unavailable'>(done => { resolve = done; }));
  const opening = createCanvasCardOpening({ kernel: { readCamera: () => ({ x: 0, y: 0, zoom: 0.1 }), setCamera, finishTransitions }, readCard: () => card, finish: async () => true, cameraChanged, prepare, openText, openMedia: async () => {}, unavailable });
  const first = opening.open(card.id); await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
  expect(setCamera).toHaveBeenCalledWith({ x: -252, y: -404, zoom: 1 }); expect(cameraChanged).toHaveBeenCalledOnce(); expect(openText).not.toHaveBeenCalled();
  expect(finishTransitions).toHaveBeenCalledWith([card.id]);
  opening.cancel(); resolve('ready'); await first; expect(openText).not.toHaveBeenCalled();
  const second = opening.open(card.id); await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(2)); resolve('unavailable'); await second;
  expect(openText).toHaveBeenCalledExactlyOnceWith(card.id); expect(unavailable).toHaveBeenCalledOnce(); opening.dispose();
});
it('等待旧草稿保存时切换选择，迟到保存不再移动相机或准备旧卡', async () => {
  let saved!: (value: boolean) => void;
  const finishTransitions = vi.fn(), prepare = vi.fn(async () => 'ready' as const), setCamera = vi.fn();
  const opening = createCanvasCardOpening({ kernel: { readCamera: () => ({ x: 0, y: 0, zoom: 0.1 }), setCamera, finishTransitions }, readCard: () => card,
    finish: () => new Promise<boolean>(resolve => { saved = resolve; }), cameraChanged: vi.fn(), prepare, openText: vi.fn(), openMedia: vi.fn(), unavailable: vi.fn() });
  const pending = opening.open(card.id); opening.cancel(); saved(true); await pending;
  expect(finishTransitions).not.toHaveBeenCalled(); expect(setCamera).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled(); opening.dispose();
});
