import { useSlideThumbnailResources } from './useSlideThumbnailResources';
import { describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { PresentationRenderModel, RenderNode, SlideRenderModel } from '../../../types/render';
import type { SlideRasterRequest } from '../../../../shared/slideRasterization';
import { createSlideThumbnailSources } from '../functions/createSlideThumbnailSources';
import { useSlidesThumbnailStore } from '../store/slidesThumbnailStore';
import { createSlideThumbnailRenderer } from './createSlideThumbnailRenderer';

function page(color: string, elements: RenderNode[] = []): SlideRenderModel {
  return { slideId: '', index: 0, layoutKey: 'structured', background: { paint: { type: 'solid', color } }, elements };
}

function model(pages: SlideRenderModel[]): PresentationRenderModel {
  return {
    presentationId: 'deck', version: 1, title: 'Deck', sourceKind: 'generated',
    slideSize: { width: 10, height: 5.625, unit: 'in' },
    slides: pages.map((slide, index) => ({ ...slide, slideId: `s${index + 1}`, index })),
    capabilities: { hasSemanticRender: true, hasReferencePreview: false, hasHitTest: true, hasSelection: true },
  };
}

function bitmap(): ImageBitmap { return { width: 256, height: 144, close: vi.fn() }; }

function deferredBitmap() {
  let resolve!: (value: ImageBitmap) => void;
  const promise = new Promise<ImageBitmap>(done => { resolve = done; });
  return { promise, resolve };
}

function harness() {
  setActivePinia(createPinia());
  const store = useSlidesThumbnailStore();
  const jobs = new Set<() => void>();
  const render = vi.fn<(_request: SlideRasterRequest, _signal: AbortSignal) => Promise<ImageBitmap>>()
    .mockImplementation(async () => bitmap());
  const reportFailure = vi.fn();
  const runtime = createSlideThumbnailRenderer({ render, publish: useSlideThumbnailResources().applySnapshot, reportFailure,
    schedule: job => { jobs.add(job); return () => jobs.delete(job); },
  });
  function update(pages: SlideRenderModel[], width = 128) {
    runtime.update(createSlideThumbnailSources(model(pages)), width);
  }
  async function step() {
    const job = jobs.values().next().value;
    if (job) { jobs.delete(job); job(); }
    await Promise.resolve();
  }
  async function drain() { while (jobs.size) await step(); }
  return { store, render, runtime, reportFailure, update, step, drain, jobs };
}

describe('incremental thumbnail lifecycle', () => {
  it('插入只画新页，复制共用位图，删除与重排仅更新页序映射', async () => {
    const h = harness();
    const a = page('#FF0000'), b = page('#00FF00'), blank = page('#FFFFFF');
    h.update([a, b]);
    expect(h.render).not.toHaveBeenCalled(); // 画布更新后才开始后台工作。
    await h.drain();
    const aBitmap = useSlideThumbnailResources().getThumbnail('s1'), bBitmap = useSlideThumbnailResources().getThumbnail('s2');
    h.update([a, blank, b]);
    expect(useSlideThumbnailResources().getThumbnail('s3')).toBe(bBitmap);
    expect(useSlideThumbnailResources().getThumbnail('s2')).toBeNull(); // 不能把原来的第二页误认为空白页。
    await h.drain();
    expect(h.render).toHaveBeenCalledTimes(3);
    h.update([a, a, blank, b]);
    await h.drain();
    expect(useSlideThumbnailResources().getThumbnail('s2')).toBe(aBitmap);
    expect(h.render).toHaveBeenCalledTimes(3);
    h.update([b, a]);
    expect(useSlideThumbnailResources().getThumbnail('s1')).toBe(bBitmap);
    expect(useSlideThumbnailResources().getThumbnail('s2')).toBe(aBitmap);
    expect(aBitmap?.close).not.toHaveBeenCalled();
    await h.drain();
    expect(h.render).toHaveBeenCalledTimes(3);
    h.runtime.clear();
    expect(aBitmap?.close).toHaveBeenCalledTimes(1);
    expect(bBitmap?.close).toHaveBeenCalledTimes(1);
  });

  it('修改副本只重画副本，原图仍可用；不变修订保留 store 映射引用', async () => {
    const h = harness();
    const a = page('#FF0000');
    h.update([a, a]); await h.drain();
    const original = useSlideThumbnailResources().getThumbnail('s1');
    const cache = useSlideThumbnailResources().cache.value;
    h.update([structuredClone(a), structuredClone(a)]);
    expect(useSlideThumbnailResources().cache.value).toBe(cache);
    h.update([a, page('#0000FF')]); await h.drain();
    expect(h.render).toHaveBeenCalledTimes(2);
    expect(useSlideThumbnailResources().getThumbnail('s1')).toBe(original);
    expect(useSlideThumbnailResources().getThumbnail('s2')).not.toBe(original);
    expect(original?.close).not.toHaveBeenCalled();
    h.runtime.clear();
  });

  it('跨修订保留未变的进行中任务，并优先绘制当前页', async () => {
    const h = harness(), pending = deferredBitmap();
    const a = page('#FF0000'), b = page('#00FF00');
    h.render.mockReturnValueOnce(pending.promise);
    h.runtime.prioritize('s2');
    h.update([a, b]); await h.step();
    expect(h.render.mock.calls[0]?.[0].slide.slideId).toBe('s2');
    const signal = h.render.mock.calls[0]?.[1];
    h.update([b, a, b]);
    expect(signal?.aborted).toBe(false);
    const ready = bitmap(); pending.resolve(ready); await Promise.resolve();
    expect(useSlideThumbnailResources().getThumbnail('s1')).toBe(ready);
    expect(useSlideThumbnailResources().getThumbnail('s3')).toBe(ready);
    await h.drain();
    expect(h.render).toHaveBeenCalledTimes(2);
    h.runtime.clear();
    expect(ready.close).toHaveBeenCalledTimes(1);
  });

  it('删除生成中的页面或切换文档后，迟到的位图被关闭且不会覆盖新文档', async () => {
    const h = harness(), pending = deferredBitmap();
    const a = page('#FF0000');
    h.render.mockReturnValueOnce(pending.promise);
    h.update([a]); await h.step();
    const oldSignal = h.render.mock.calls[0]?.[1];
    h.runtime.clear();
    h.update([a]); await h.drain();
    const current = useSlideThumbnailResources().getThumbnail('s1');
    const late = bitmap(); pending.resolve(late); await Promise.resolve();
    expect(oldSignal?.aborted).toBe(true);
    expect(late.close).toHaveBeenCalledTimes(1);
    expect(useSlideThumbnailResources().getThumbnail('s1')).toBe(current);
    expect(h.store.generating).toBe(false);
    h.runtime.clear();
  });

  it('平铺增大分辨率时保留旧图，缩小、后续修订和重新打开平铺均复用高清图', async () => {
    const h = harness();
    const pages = [page('#FF0000')];
    h.update(pages); await h.drain();
    const small = useSlideThumbnailResources().getThumbnail('s1');
    h.update(pages, 320);
    expect(useSlideThumbnailResources().getThumbnail('s1')).toBe(small);
    await h.drain();
    expect(h.render.mock.calls[1]?.[0].profile.viewportWidthPx).toBe(320);
    expect(small?.close).toHaveBeenCalledTimes(1);
    const large = useSlideThumbnailResources().getThumbnail('s1');
    h.update(pages); h.update([structuredClone(pages[0])]); h.update(pages, 320);
    await h.drain();
    expect(h.render).toHaveBeenCalledTimes(2);
    expect(useSlideThumbnailResources().getThumbnail('s1')).toBe(large);
    h.runtime.clear();
  });

  it('单页资源失败不会阻断其余页或无限重试，下次正式更新可重试', async () => {
    const h = harness(), pages = [page('#FF0000'), page('#00FF00')];
    h.render.mockRejectedValueOnce(new Error('Image unavailable'));
    h.update(pages); await h.drain();
    expect(h.store.cachedCount).toBe(1);
    expect(h.store.generating).toBe(false);
    expect(h.reportFailure).toHaveBeenCalledTimes(1);
    h.update(pages); await h.drain();
    expect(h.render).toHaveBeenCalledTimes(3);
    expect(h.store.cachedCount).toBe(2);
    h.runtime.clear();
    expect(h.jobs.size).toBe(0);
  });

  it('嵌套分组和形状内文本排除编辑身份，画布尺寸、正文、字号、填充变化仍失效', () => {
    const text: RenderNode = { kind: 'text', id: 'old-text', zIndex: 0,
      box: { x: 0, y: 0, w: 2, h: 1, unit: 'in' }, paragraphs: [{ runs: [{ text: 'Hello', fontSize: 18 }] }] };
    const shape: RenderNode = { kind: 'shape', id: 'old-shape', zIndex: 0,
      box: text.box, geometry: { type: 'preset', name: 'rect' }, innerText: text };
    const group: RenderNode = { kind: 'group', id: 'old-group', zIndex: 0, box: text.box, children: [shape] };
    const original = model([page('#FFFFFF', [group])]);
    const changedIdentity = model([page('#FFFFFF', [{ ...group, id: 'new-group', children: [
      { ...shape, id: 'new-shape', sourceSpan: { startLine: 20, endLine: 23 },
        innerText: { ...text, id: 'new-text', authoringRef: { slideKey: 'copy', editKey: 'title' } } },
    ] }])]);
    const key = (value: PresentationRenderModel) => createSlideThumbnailSources(value)[0]?.contentKey;
    expect(key(changedIdentity)).toBe(key(original));
    expect(key({ ...original, slideSize: { ...original.slideSize, width: 12 } })).not.toBe(key(original));
    for (const run of [{ text: 'Changed', fontSize: 18 }, { text: 'Hello', fontSize: 24 }]) {
      const edited = model([page('#FFFFFF', [{ ...shape, innerText: { ...text, paragraphs: [{ runs: [run] }] } }])]);
      expect(key(edited)).not.toBe(key(model([page('#FFFFFF', [shape])])));
    }
  });
});
