import { createMarkdownDocumentFragment } from '@linnya/markdown-document-core';
import { JsonValueSchema } from '@app/schemas';
import type { CanvasCard, CanvasCardId } from '@plugin/canvas/shared';
import type { CanvasAppearance, CanvasKernel, CanvasRasterTile } from '../kernel';
import { cardRasterKey, createHtmlCardRasterizer, createLatestRasterQueue, resolveVisibleCardRegions } from '../capabilities/textRasterization';

type RasterInput = { readonly card: CanvasCard; readonly scale: number; readonly dark: boolean; readonly regions: ReturnType<typeof resolveVisibleCardRegions> };

/** 可见内容的派生投影；正文/相机/主题都由各owner提供，不另存一份正文。 */
export function createCanvasRasterPresentation(options: {
  readonly host: HTMLElement;
  readonly kernel: CanvasKernel;
  readonly readAppearance: () => CanvasAppearance;
  readonly reportFailure: (message: string) => void;
  readonly createContent?: (card: CanvasCard, signal: AbortSignal) => Promise<HTMLElement>;
}) {
  const rasterizer = createHtmlCardRasterizer({ host: options.host });
  const pending = new Map<CanvasCardId, string>();
  const descriptors = new WeakMap<CanvasCard, string>();
  const descriptor = (card: CanvasCard) => {
    const existing = descriptors.get(card);
    if (existing) return existing;
    // revision 也会因移动/颜色变化递增；正文键只记录真正影响正文与排版的事实。
    const value = JSON.stringify([card.type, card.width, card.height, card.data]);
    descriptors.set(card, value); return value;
  };
  let disposed = false;
  let pump = 0;
  let refreshes = 0;
  let maximumRefreshMs = 0;
  let cameraKey = '';
  let cameraChangedAt = 0;
  let precisionTimer: ReturnType<typeof setTimeout> | undefined;
  const queue = createLatestRasterQueue({
    execute: async (input: RasterInput, signal) => {
      const element = options.createContent ? await options.createContent(input.card, signal) : document.createElement('div');
      element.classList.add('markdown-document-content', 'canvas-card-content');
      element.style.color = input.dark ? '#e8e9e3' : '#252c27';
      if (!options.createContent) {
        if (input.card.type === 'text') element.append(createMarkdownDocumentFragment(JsonValueSchema.parse(input.card.data.content), document));
        else element.textContent = input.card.type === 'document' ? '文档' : input.card.data.caption || '图片';
      }
      if (input.card.type === 'text') {
        const contentHeight = await rasterizer.measure(element, input.card.width, signal);
        element.classList.toggle('canvas-card-content-clipped', contentHeight > input.card.height);
        element.style.position = 'relative'; element.style.height = `${input.card.height}px`;
      }
      const tiles: CanvasRasterTile[] = [];
      try {
        for (const region of input.regions) {
          const result = await rasterizer.rasterize({ element, width: input.card.width, height: region.height, scale: input.scale,
            tileWidth: region.width, offsetX: region.offsetX, offsetY: region.offsetY }, signal);
          tiles.push({ bitmap: result.bitmap, x: region.offsetX, y: region.offsetY, width: region.width, height: region.height });
        }
        return tiles;
      } catch (failure) { for (const tile of tiles) tile.bitmap.close(); throw failure; }
    },
    disposeResult: tiles => { for (const tile of tiles) tile.bitmap.close(); },
  });
  const schedule = () => {
    if (pump || disposed) return;
    pump = requestAnimationFrame(() => { pump = 0; refresh(); });
  };
  function refresh(): void {
    if (disposed) return;
    const started = performance.now();
    const camera = options.kernel.readCamera(), appearance = options.readAppearance();
    const nextCameraKey = `${camera.x}:${camera.y}:${camera.zoom}:${devicePixelRatio}`;
    if (nextCameraKey !== cameraKey) {
      cameraKey = nextCameraKey; cameraChangedAt = performance.now(); clearTimeout(precisionTimer);
      precisionTimer = setTimeout(() => { precisionTimer = undefined; refresh(); }, 100);
    }
    const visible = options.kernel.renderableCards();
    const ids = new Set(visible.map(card => card.id));
    for (const id of pending.keys()) if (!ids.has(id)) { queue.cancel(id); pending.delete(id); }
    // 远景标题是正式显示模式，不为已不显示的正文生成不可见位图。
    if (camera.zoom < 0.3 && appearance.overview === 'titles') {
      for (const id of pending.keys()) queue.cancel(id);
      pending.clear(); return;
    }
    const font = getComputedStyle(options.host).fontFamily;
    const topLeft = options.kernel.screenToWorld({ x: 0, y: 0 });
    const bottomRight = options.kernel.screenToWorld({ x: options.kernel.canvas.clientWidth, y: options.kernel.canvas.clientHeight });
    for (const card of visible) {
      const screenWidth = card.width * camera.zoom * devicePixelRatio;
      const precise = camera.zoom >= 0.75 && visible.length <= 40 && performance.now() - cameraChangedAt >= 100;
      const physicalWidth = precise ? screenWidth : screenWidth <= 140 ? 70 : screenWidth <= 280 ? 280 : screenWidth <= 560 ? 560 : 1120;
      const scale = physicalWidth / card.width;
      const regions = resolveVisibleCardRegions({ cardX: card.x, cardY: card.y, cardWidth: card.width, cardHeight: card.height,
        worldLeft: topLeft.x, worldTop: topLeft.y, worldRight: bottomRight.x, worldBottom: bottomRight.y, scale });
      const content = descriptor(card);
      const key = cardRasterKey({ revision: 0, theme: appearance.dark ? 'dark' : 'light', dpr: devicePixelRatio,
        material: 'body', lod: physicalWidth, font: `${font}/14/1.7`, uiScale: 1 }) + content + JSON.stringify(regions);
      if (pending.get(card.id) === key || options.kernel.hasBitmap(card.id, key)) continue;
      if (pending.has(card.id)) { queue.cancel(card.id); pending.delete(card.id); }
      // 不能把几百张可见卡反复冲入64槽队列；完成一个任务后再补下一张。
      if (pending.size >= 65) break;
      pending.set(card.id, key);
      void queue.enqueue(card.id, { card, scale, dark: appearance.dark, regions }).then(result => {
        if (pending.get(card.id) === key) pending.delete(card.id);
        if (result.status === 'ready') {
          const current = options.kernel.visibleCards().find(candidate => candidate.id === card.id);
          if (current && descriptor(current) === content) options.kernel.setRasterTiles(card.id, current.revision, key, result.value);
          else for (const tile of result.value) tile.bitmap.close();
        }
        else if (result.status === 'failed') options.reportFailure(result.error instanceof Error ? result.error.message : String(result.error));
        if (result.status === 'ready') schedule();
      });
    }
    refreshes++; maximumRefreshMs = Math.max(maximumRefreshMs, performance.now() - started);
  }
  return { refresh, readStats: () => ({ ...queue.readStats(), refreshes, maximumRefreshMs }),
    dispose() { disposed = true; clearTimeout(precisionTimer); if (pump) cancelAnimationFrame(pump); queue.dispose(); rasterizer.dispose(); } };
}
