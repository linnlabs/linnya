interface DrawableContext extends CanvasRenderingContext2D { drawElementImage(element: Element, x: number, y: number): void }
interface PaintCanvas extends HTMLCanvasElement { requestPaint(): void }
export function canDrawHtmlElement(context: CanvasRenderingContext2D): context is DrawableContext { return typeof Reflect.get(context, 'drawElementImage') === 'function'; }
function canRequest(canvas: HTMLCanvasElement): canvas is PaintCanvas { return typeof Reflect.get(canvas, 'requestPaint') === 'function'; }
export async function prepareRasterDom(element: HTMLElement, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted(); await element.ownerDocument.fonts.ready;
  await Promise.all(Array.from(element.querySelectorAll('img'), async image => {
    const source = image.currentSrc || image.src;
    if (source && !source.startsWith('blob:') && !source.startsWith('data:')) throw new Error('raster_image_requires_managed_bytes');
    if (source) await image.decode();
  }));
  signal?.throwIfAborted();
}
export function waitForHtmlCanvasPaint(canvas: HTMLCanvasElement, draw: () => void, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); canvas.removeEventListener('paint', onPaint); signal?.removeEventListener('abort', onAbort); };
    const onAbort = () => { cleanup(); reject(signal?.reason ?? new Error('raster_cancelled')); };
    const onPaint = () => { cleanup(); try { signal?.throwIfAborted(); draw(); resolve(); } catch (error) { reject(error); } };
    const timer = setTimeout(() => { cleanup(); reject(new Error('raster_paint_timeout')); }, timeoutMs);
    canvas.addEventListener('paint', onPaint); signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort(); else if (canRequest(canvas)) canvas.requestPaint();
  });
}
