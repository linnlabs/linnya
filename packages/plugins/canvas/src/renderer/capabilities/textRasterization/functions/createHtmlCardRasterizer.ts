import type { CardRasterizer, CardRasterRequest, CardRasterResult } from '../definitions/cardRasterization';

interface DrawableContext extends CanvasRenderingContext2D {
  drawElementImage(element: Element, x: number, y: number): void;
}
interface PaintCanvas extends HTMLCanvasElement { requestPaint(): void }
function canDraw(context: CanvasRenderingContext2D): context is DrawableContext {
  return typeof Reflect.get(context, 'drawElementImage') === 'function';
}
function canRequest(canvas: HTMLCanvasElement): canvas is PaintCanvas {
  return typeof Reflect.get(canvas, 'requestPaint') === 'function';
}

function assertActive(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

async function prepare(element: HTMLElement, signal?: AbortSignal): Promise<void> {
  assertActive(signal);
  await element.ownerDocument.fonts.ready;
  await Promise.all(Array.from(element.querySelectorAll('img'), async (image) => {
    // 受管图片必须由内容 provider 转为 blob/data URL；不能放宽 media 协议的 CORS。
    const source = image.currentSrc || image.src;
    if (source && !source.startsWith('blob:') && !source.startsWith('data:')) {
      throw new Error('raster_image_requires_managed_bytes');
    }
    if (source) await image.decode();
  }));
  assertActive(signal);
}

function waitForPaint(canvas: HTMLCanvasElement, draw: () => void, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      canvas.removeEventListener('paint', onPaint);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => { cleanup(); reject(signal?.reason ?? new Error('raster_cancelled')); };
    const onPaint = () => {
      cleanup();
      try { assertActive(signal); draw(); resolve(); } catch (error) { reject(error); }
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('raster_paint_timeout')); }, timeoutMs);
    canvas.addEventListener('paint', onPaint);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    else if (canRequest(canvas)) canvas.requestPaint();
  });
}

/**
 * 只消费已由 Host 正式正文 renderer 构造的 DOM，不理解 Tiptap/画布业务结构。
 * 光栅器独占 staging host；使用者应通过有界队列串行调用。
 */
export function createHtmlCardRasterizer(options: {
  readonly host: HTMLElement;
  readonly timeoutMs?: number;
  readonly maxTextureEdge?: number;
}): CardRasterizer {
  const document = options.host.ownerDocument;
  const canvas = document.createElement('canvas');
  const viewport = document.createElement('div');
  const source = document.createElement('div');
  const modern = 'content' in canvas;
  canvas.setAttribute(modern ? 'content' : 'layoutsubtree', modern ? 'drawable' : '');
  viewport.setAttribute('drawable', '');
  viewport.style.cssText = 'position:relative;overflow:hidden';
  viewport.append(source);
  canvas.append(viewport);
  // opacity:0 会在部分 Chromium 版本破坏 paint record。宿主应放在视图底层。
  canvas.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;z-index:-1';
  options.host.append(canvas);
  let disposed = false;

  async function install(element: HTMLElement, width: number, signal?: AbortSignal): Promise<HTMLElement> {
    if (disposed) throw new Error('rasterizer_disposed');
    if (!Number.isFinite(width) || width <= 0) throw new Error('invalid_raster_width');
    const clone = element.cloneNode(true);
    if (!(clone instanceof HTMLElement)) throw new Error('invalid_raster_dom');
    source.replaceChildren(clone);
    source.style.width = `${width}px`;
    await prepare(source, signal);
    return clone;
  }

  return {
    async measure(element, width, signal) {
      await install(element, width, signal);
      source.style.transform = '';
      return source.getBoundingClientRect().height;
    },
    async rasterize(request: CardRasterRequest, signal): Promise<CardRasterResult> {
      const { width, height, scale } = request;
      const tileWidth = request.tileWidth ?? width;
      const physicalWidth = Math.ceil(tileWidth * scale);
      const physicalHeight = Math.ceil(height * scale);
      const maxEdge = options.maxTextureEdge ?? 4096;
      if (![tileWidth, height, scale].every((n) => Number.isFinite(n) && n > 0)
        || physicalWidth > maxEdge || physicalHeight > maxEdge) throw new Error('raster_tile_limit');
      await install(request.element, width, signal);
      const contentHeight = source.getBoundingClientRect().height;
      source.style.transform = `translate(${-Math.max(0, request.offsetX ?? 0)}px,${-Math.max(0, request.offsetY ?? 0)}px)`;
      viewport.style.width = canvas.style.width = `${tileWidth}px`;
      viewport.style.height = canvas.style.height = `${height}px`;
      canvas.width = physicalWidth;
      canvas.height = physicalHeight;
      const context = canvas.getContext('2d');
      if (!context || !canDraw(context)) throw new Error('html_canvas_unavailable');
      await waitForPaint(canvas, () => {
        // HTML-in-Canvas 以 backing/CSS 比例生成记录；再次 scale 会把正文放大两遍。
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, physicalWidth, physicalHeight);
        context.drawElementImage(viewport, 0, 0);
      }, options.timeoutMs ?? 2000, signal);
      const bitmap = await createImageBitmap(canvas);
      if (signal?.aborted || disposed) {
        bitmap.close();
        assertActive(signal);
        throw new Error('rasterizer_disposed');
      }
      return { bitmap, width: tileWidth, height, contentHeight };
    },
    dispose() { disposed = true; canvas.remove(); },
  };
}
