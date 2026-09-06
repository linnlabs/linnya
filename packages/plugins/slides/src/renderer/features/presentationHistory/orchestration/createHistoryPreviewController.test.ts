import { expect, it, vi } from 'vitest';
import type { PresentationRenderModel } from '@plugin/slides/shared/renderModel';
import { createHistoryPreviewController } from './createHistoryPreviewController';

const model: PresentationRenderModel = {
  presentationId: 'doc',
  title: 'test',
  version: 1,
  sourceKind: 'generated',
  slides: Array.from({ length: 3 }, (_, index) => ({
    slideId: `s${index}`,
    index,
    layoutKey: 'freeform',
    background: { paint: { kind: 'solid', color: '#FFFFFF' } },
    elements: [],
  })),
  slideSize: { width: 10, height: 7.5 },
  capabilities: {
    hasSemanticRender: true,
    hasReferencePreview: false,
    hasHitTest: false,
    hasSelection: false,
  },
};

it('切页丢弃迟到正文图片，关闭后释放当前 bitmap', async () => {
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

it('只渲染选中页；首尾不越界、无页不渲染、翻页和关闭释放图片', async () => {
  const images: ImageBitmap[] = [];
  const render = vi.fn(async (): Promise<ImageBitmap> => {
    const image = { width: 1, height: 1, close: vi.fn() };
    images.push(image);
    return image;
  });
  const publish = vi.fn();
  const controller = createHistoryPreviewController({
    read: async () => model,
    render,
    publish,
    report: vi.fn(),
  });
  await controller.load();
  expect(render).toHaveBeenCalledTimes(1);
  await controller.select(-1);
  await controller.select(3);
  expect(render).toHaveBeenCalledTimes(1);
  await controller.select(1);
  expect(images[0].close).toHaveBeenCalledOnce();
  expect(render).toHaveBeenCalledTimes(2);
  expect(publish).toHaveBeenLastCalledWith(
    expect.objectContaining({
      pageIndex: 1,
      bitmap: images[1],
      phase: 'ready',
    })
  );
  controller.dispose();
  expect(images.every(image => vi.mocked(image.close).mock.calls.length === 1)).toBe(true);
  const empty = createHistoryPreviewController({
    read: async () => ({ ...model, slides: [] }),
    render,
    publish,
    report: vi.fn(),
  });
  await empty.load();
  expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'empty' }));
  expect(render).toHaveBeenCalledTimes(2);
  empty.dispose();
});

it('正文失败后可继续翻页，不预渲染其他页', async () => {
  const publish = vi.fn();
  const report = vi.fn();
  const render = vi
    .fn(async (): Promise<ImageBitmap> => ({ width: 1, height: 1, close() {} }))
    .mockRejectedValueOnce(new Error('page failed'));
  const controller = createHistoryPreviewController({
    read: async () => model,
    render,
    publish,
    report,
  });
  await controller.load();
  expect(publish).toHaveBeenLastCalledWith(
    expect.objectContaining({ phase: 'failed', pageIndex: 0 })
  );
  await controller.select(1);
  expect(publish).toHaveBeenLastCalledWith(
    expect.objectContaining({ phase: 'ready', pageIndex: 1 })
  );
  expect(render).toHaveBeenCalledTimes(2);
  expect(report).toHaveBeenCalledOnce();
  controller.dispose();
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
