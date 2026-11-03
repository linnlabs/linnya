import type { CanvasCard, CanvasCardId } from '@plugin/canvas/shared';
import type { CanvasAppearance, CanvasKernel } from '../kernel';
import { cardRasterKey, createHtmlCardRasterizer, createLatestRasterQueue, splitCardRasterRegions } from '../capabilities/textRasterization';

import { createCanvasCardRasterBatch } from '../features/cardRendering';

/** 可见内容的派生投影；正文/相机/主题都由各owner提供，不另存一份正文。 */
export function createCanvasRasterPresentation(options: {
  readonly host: HTMLElement;
  readonly kernel: CanvasKernel;
  readonly readAppearance: () => CanvasAppearance;
  readonly reportFailure: (message: string) => void;
  readonly createContent?: (card: CanvasCard, signal: AbortSignal) => Promise<HTMLElement>;
  readonly readContentKey?: (card: CanvasCard) => string;
}) {
  const rasterizer = createHtmlCardRasterizer({ host: options.host });
  const pending = new Map<CanvasCardId, string>();
  const failed = new Map<CanvasCardId, string>();
  const descriptors = new WeakMap<CanvasCard, string>();
  const descriptor = (card: CanvasCard) => {
    const existing = descriptors.get(card);
    if (existing) return existing;
    // 移动也递增revision，但不改变正文；染纸会改变深墨，因此颜色必须入键。
    const value = JSON.stringify([card.type, card.width, card.height, card.color, card.data]);
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
    batchSize: 32, executeBatch: createCanvasCardRasterBatch({ rasterizer, createContent: options.createContent }),
    disposeResult: output => { if (output.kind === 'ready') for (const tile of output.tiles) tile.bitmap.close(); },
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
    const visible = options.kernel.rasterCards();
    const ids = new Set(visible.map(card => card.id));
    for (const id of pending.keys()) if (!ids.has(id)) { queue.cancel(id); pending.delete(id); }
    const font = getComputedStyle(options.host).fontFamily;
    const prioritized = visible.map(card => ({ card, regions: options.kernel.readVisibleCardRegions(card.id) }))
      .sort((a, b) => b.regions.reduce((sum, region) => sum + region.width * region.height, 0) - a.regions.reduce((sum, region) => sum + region.width * region.height, 0));
    for (const { card, regions: visibleRegions } of prioritized) {
      const screenWidth = card.width * camera.zoom * devicePixelRatio;
      const precise = camera.zoom >= 0.75 && visible.length <= 40 && performance.now() - cameraChangedAt >= 100;
      const physicalWidth = precise ? screenWidth : screenWidth <= 140 ? 70 : screenWidth <= 280 ? 280 : screenWidth <= 560 ? 560 : 1120;
      const scale = physicalWidth / card.width;
      const content = descriptor(card);
      const externalKey = options.readContentKey?.(card) ?? '';
      const key = cardRasterKey({ revision: 0, theme: appearance.dark ? 'dark' : 'light', dpr: devicePixelRatio,
        material: 'body', lod: physicalWidth, font: `${font}/14/1.7`, uiScale: 1 }) + content + externalKey;
      if (failed.get(card.id) === key) continue;
      const regions = splitCardRasterRegions(options.kernel.readMissingBitmapRegions(card.id, key, visibleRegions), scale);
      if (!regions.length) continue;
      const jobKey = key + JSON.stringify(regions);
      if (pending.get(card.id) === jobKey) continue;
      if (pending.has(card.id)) { queue.cancel(card.id); pending.delete(card.id); }
      // 不能把几百张可见卡反复冲入64槽队列；完成一个任务后再补下一张。
      if (pending.size >= 65) break;
      pending.set(card.id, jobKey);
      void queue.enqueue(card.id, { card, scale, dark: appearance.dark, regions }).then(result => {
        if (pending.get(card.id) === jobKey) pending.delete(card.id);
        if (result.status === 'ready' && result.value.kind === 'ready') {
          const current = options.kernel.visibleCards().find(candidate => candidate.id === card.id);
          if (current && descriptor(current) === content && (options.readContentKey?.(current) ?? '') === externalKey) options.kernel.setRasterTiles(card.id, current.revision, key, result.value.tiles);
          else for (const tile of result.value.tiles) tile.bitmap.close();
        }
        else if (result.status === 'ready' && result.value.kind === 'failed') {
          const error = result.value.error;
          failed.set(card.id, key); options.reportFailure(error instanceof Error ? error.message : String(error));
        } else if (result.status === 'failed') {
          const error = result.error;
          failed.set(card.id, key); options.reportFailure(error instanceof Error ? error.message : String(error));
        }
        if (result.status === 'ready') schedule();
      });
    }
    refreshes++; maximumRefreshMs = Math.max(maximumRefreshMs, performance.now() - started);
  }
  return { refresh, retry() { failed.clear(); refresh(); }, readStats: () => ({ ...queue.readStats(), failed: failed.size, refreshes, maximumRefreshMs }),
    dispose() { disposed = true; clearTimeout(precisionTimer); if (pump) cancelAnimationFrame(pump); queue.dispose(); rasterizer.dispose(); } };
}
