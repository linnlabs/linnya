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
}) {
  const rasterizer = createHtmlCardRasterizer({ host: options.host });
  const pending = new Map<CanvasCardId, string>();
  let disposed = false;
  let pump = 0;
  const queue = createLatestRasterQueue({
    execute: async (input: RasterInput, signal) => {
      const element = document.createElement('div');
      element.className = 'markdown-document-content canvas-card-content';
      element.style.color = input.dark ? '#e8e9e3' : '#252c27';
      if (input.card.type === 'text') element.append(createMarkdownDocumentFragment(JsonValueSchema.parse(input.card.data.content), document));
      else element.textContent = input.card.type === 'document' ? '文档' : input.card.data.caption || '图片';
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
    const camera = options.kernel.readCamera(), appearance = options.readAppearance();
    const visible = options.kernel.visibleCards();
    const ids = new Set(visible.map(card => card.id));
    for (const id of pending.keys()) if (!ids.has(id)) { queue.cancel(id); pending.delete(id); }
    // 远景标题是正式显示模式，不为已不显示的正文生成不可见位图。
    if (camera.zoom < 0.3 && appearance.overview === 'titles') return;
    const font = getComputedStyle(options.host).fontFamily;
    const topLeft = options.kernel.screenToWorld({ x: 0, y: 0 });
    const bottomRight = options.kernel.screenToWorld({ x: options.kernel.canvas.clientWidth, y: options.kernel.canvas.clientHeight });
    for (const card of visible) {
      const physicalWidth = Math.min(1120, Math.max(70, card.width * camera.zoom * devicePixelRatio));
      const scale = Math.min(4, physicalWidth / card.width);
      const regions = resolveVisibleCardRegions({ cardX: card.x, cardY: card.y, cardWidth: card.width, cardHeight: card.height,
        worldLeft: topLeft.x, worldTop: topLeft.y, worldRight: bottomRight.x, worldBottom: bottomRight.y, scale });
      const key = cardRasterKey({ revision: card.revision, theme: appearance.dark ? 'dark' : 'light', dpr: devicePixelRatio,
        material: 'body', lod: Math.ceil(physicalWidth / 140), font, uiScale: 1 }) + JSON.stringify(regions);
      if (pending.get(card.id) === key || options.kernel.hasBitmap(card.id, key)) continue;
      pending.set(card.id, key);
      void queue.enqueue(card.id, { card, scale, dark: appearance.dark, regions }).then(result => {
        if (pending.get(card.id) === key) pending.delete(card.id);
        if (result.status === 'ready') options.kernel.setRasterTiles(card.id, card.revision, key, result.value);
        else if (result.status === 'failed') options.reportFailure(result.error instanceof Error ? result.error.message : String(result.error));
        if (result.status === 'ready') schedule();
      });
    }
  }
  return { refresh, readStats: queue.readStats,
    dispose() { disposed = true; if (pump) cancelAnimationFrame(pump); queue.dispose(); rasterizer.dispose(); } };
}
