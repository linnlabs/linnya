import type { CardRasterizer, CardRasterRequest } from '../definitions/cardRasterization';
import { prepareRasterImages, waitForRasterFonts } from './htmlCanvasPaint';
import { rasterizeHtmlBatch } from './rasterizeHtmlBatch';

/** 只消费正式正文DOM；同一实例由有界队列串行使用，既可测量也可单页批量光栅。 */
export function createHtmlCardRasterizer(options: {
  readonly host: HTMLElement;
  readonly timeoutMs?: number;
  readonly maxTextureEdge?: number;
}): CardRasterizer {
  const document = options.host.ownerDocument;
  const canvas = document.createElement('canvas'), viewport = document.createElement('div');
  const modern = 'content' in canvas;
  canvas.setAttribute(modern ? 'content' : 'layoutsubtree', modern ? 'drawable' : '');
  viewport.setAttribute('drawable', ''); viewport.style.cssText = 'position:relative;overflow:hidden';
  canvas.append(viewport);
  // opacity:0 会在部分Chromium破坏paint记录，staging由使用方放在底层。
  canvas.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;z-index:-1'; options.host.append(canvas);
  let disposed = false;
  const lifetime = new AbortController();
  const activeSignal = (signal?: AbortSignal) => signal ? AbortSignal.any([lifetime.signal, signal]) : lifetime.signal;
  async function measureBatch(requests: readonly { readonly element: HTMLElement; readonly width: number }[], signal?: AbortSignal): Promise<readonly PromiseSettledResult<number>[]> {
    if (disposed) throw new Error('rasterizer_disposed');
    const active = activeSignal(signal);
    const sources = requests.map(request => {
      if (!Number.isFinite(request.width) || request.width <= 0) throw new Error('invalid_raster_width');
      const source = document.createElement('div'); source.style.width = `${request.width}px`;
      source.append(request.element.cloneNode(true)); return source;
    });
    viewport.replaceChildren(...sources); viewport.style.width = `${Math.max(1, ...requests.map(request => request.width))}px`; viewport.style.height = 'auto';
    // ready getter本身会同步刷新布局；只在整批DOM安装后读取一次，不跨批缓存。
    const fontsReady = sources.length ? waitForRasterFonts(document, active) : Promise.resolve();
    // 图片仍各自准备并按卡返回失败，不能因一张坏图牵连整批正文。
    const values = await Promise.allSettled(sources.map(async source => {
      await fontsReady; await prepareRasterImages(source, active); return source.getBoundingClientRect().height;
    }));
    active.throwIfAborted(); return values;
  }
  async function batch(requests: readonly CardRasterRequest[], signal?: AbortSignal) {
    if (disposed) throw new Error('rasterizer_disposed');
    const active = activeSignal(signal);
    const results = await rasterizeHtmlBatch({ canvas, viewport, requests, signal: active, maxEdge: options.maxTextureEdge ?? 4096, timeoutMs: options.timeoutMs ?? 2000 });
    if (active.aborted || disposed) { results.forEach(result => result.bitmap.close()); active.throwIfAborted(); throw new Error('rasterizer_disposed'); }
    return results;
  }
  return {
    async measure(element, width, signal) { const [result] = await measureBatch([{ element, width }], signal); if (result.status === 'rejected') throw result.reason; return result.value; },
    measureBatch,
    async rasterize(request, signal) { return (await batch([request], signal))[0]; },
    rasterizeBatch: batch,
    dispose() { disposed = true; lifetime.abort(new Error('rasterizer_disposed')); canvas.remove(); },
  };
}
