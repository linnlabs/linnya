import type { CardRasterRequest, CardRasterResult } from '../definitions/cardRasterization';
import { canDrawHtmlElement, prepareRasterDom, waitForHtmlCanvasPaint } from './htmlCanvasPaint';

interface Tile { readonly request: CardRasterRequest; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
interface Page { readonly tiles: Tile[]; width: number; height: number; scale: number }
function packPages(requests: readonly CardRasterRequest[], edge: number): readonly Page[] {
  const pages: Page[] = []; let page: Page = { tiles: [], width: 0, height: 0, scale: 1 }, x = 0, y = 0, row = 0;
  for (const request of requests) {
    const width = Math.ceil((request.tileWidth ?? request.width) * request.scale), height = Math.ceil(request.height * request.scale);
    if (![request.width, request.scale, request.height, width, height].every(value => Number.isFinite(value) && value > 0) || width > edge || height > edge) throw new Error('raster_tile_limit');
    if (x + width > edge) { x = 0; y += row; row = 0; }
    if (y + height > edge) { pages.push(page); page = { tiles: [], width: 0, height: 0, scale: 1 }; x = 0; y = 0; row = 0; }
    page.tiles.push({ request, x, y, width, height }); page.width = Math.max(page.width, x + width); page.height = Math.max(page.height, y + height); page.scale = Math.max(page.scale, request.scale);
    x += width; row = Math.max(row, height);
  }
  if (page.tiles.length) pages.push(page);
  return pages;
}
/** 同一paint装入一页真实DOM；裁出独立tile后释放atlas，不让小碎片保留整页像素。 */
export async function rasterizeHtmlBatch(options: {
  readonly canvas: HTMLCanvasElement; readonly viewport: HTMLElement; readonly requests: readonly CardRasterRequest[];
  readonly maxEdge: number; readonly timeoutMs: number; readonly signal?: AbortSignal;
}): Promise<readonly CardRasterResult[]> {
  const { canvas, viewport, signal } = options, results: CardRasterResult[] = [];
  const document = canvas.ownerDocument;
  try {
    for (const page of packPages(options.requests, options.maxEdge)) {
      signal?.throwIfAborted();
      const sources = page.tiles.map(tile => {
        const slot = document.createElement('div'), source = document.createElement('div');
        slot.style.cssText = `position:absolute;overflow:hidden;left:${tile.x / page.scale}px;top:${tile.y / page.scale}px;width:${tile.width / page.scale}px;height:${tile.height / page.scale}px`;
        source.style.cssText = `width:${tile.request.width}px;transform-origin:0 0;transform:scale(${tile.request.scale / page.scale}) translate(${-Math.max(0, tile.request.offsetX ?? 0)}px,${-Math.max(0, tile.request.offsetY ?? 0)}px)`;
        source.append(tile.request.element.cloneNode(true)); slot.append(source); return { slot, source };
      });
      viewport.replaceChildren(...sources.map(source => source.slot));
      viewport.style.width = canvas.style.width = `${page.width / page.scale}px`;
      viewport.style.height = canvas.style.height = `${page.height / page.scale}px`;
      canvas.width = page.width; canvas.height = page.height;
      await prepareRasterDom(viewport, signal);
      const context = canvas.getContext('2d');
      if (!context || !canDrawHtmlElement(context)) throw new Error('html_canvas_unavailable');
      await waitForHtmlCanvasPaint(canvas, () => {
        context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, canvas.width, canvas.height); context.drawElementImage(viewport, 0, 0);
      }, options.timeoutMs, signal);
      for (let index = 0; index < page.tiles.length; index++) {
        const tile = page.tiles[index]; signal?.throwIfAborted();
        const copy = new OffscreenCanvas(tile.width, tile.height), target = copy.getContext('2d');
        if (!target) throw new Error('raster_copy_context_missing');
        target.drawImage(canvas, tile.x, tile.y, tile.width, tile.height, 0, 0, tile.width, tile.height);
        results.push({ bitmap: copy.transferToImageBitmap(), width: tile.request.tileWidth ?? tile.request.width, height: tile.request.height,
          contentHeight: sources[index].source.getBoundingClientRect().height * page.scale / tile.request.scale });
      }
    }
    return results;
  } catch (error) { results.forEach(result => result.bitmap.close()); throw error; }
}
