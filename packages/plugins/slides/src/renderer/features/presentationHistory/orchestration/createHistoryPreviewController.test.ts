import { expect, it, vi } from 'vitest';
import type { PresentationRenderModel } from '@plugin/slides/shared/renderModel';
import { createHistoryPreviewController } from './createHistoryPreviewController';

const model: PresentationRenderModel = {
  presentationId: 'doc',
  title: 'test',
  version: 1,
  sourceKind: 'generated',
  slides: [],
  slideSize: { width: 10, height: 7.5 },
  capabilities: {
    hasSemanticRender: true,
    hasReferencePreview: false,
    hasHitTest: false,
    hasSelection: false,
  },
};

it('切页丢弃迟到图片，关闭后释放唯一保留的 bitmap', async () => {
  const completions: ((bitmap: ImageBitmap) => void)[] = [];
  const signals: AbortSignal[] = [];
  const publish = vi.fn();
  const controller = createHistoryPreviewController({
    read: async () => model,
    render: async (_model, _page, signal) => {
      signals.push(signal);
      return new Promise<ImageBitmap>(resolve => completions.push(resolve));
    },
    publish,
    report: vi.fn(),
  });
  const first = controller.load();
  await Promise.resolve();
  const second = controller.select(1);
  const stale: ImageBitmap = { width: 1, height: 1, close: vi.fn() };
  const current: ImageBitmap = { width: 2, height: 2, close: vi.fn() };
  completions[1](current);
  await second;
  completions[0](stale);
  await first;
  expect(signals[0].aborted).toBe(true);
  expect(stale.close).toHaveBeenCalledOnce();
  expect(publish).toHaveBeenLastCalledWith(
    expect.objectContaining({ pageIndex: 1, bitmap: current, phase: 'ready' })
  );
  controller.dispose();
  expect(current.close).toHaveBeenCalledOnce();
});

it('关闭时尚未返回的后端模型不触发栅格化', async () => {
  let resolve!: (value: PresentationRenderModel) => void;
  const read = new Promise<PresentationRenderModel>(done => {
    resolve = done;
  });
  const render = vi.fn(async (): Promise<ImageBitmap> => ({ width: 1, height: 1, close() {} }));
  const controller = createHistoryPreviewController({
    read: () => read,
    render,
    publish: vi.fn(),
    report: vi.fn(),
  });
  const loading = controller.load();
  controller.dispose();
  resolve(model);
  await loading;
  expect(render).not.toHaveBeenCalled();
});
