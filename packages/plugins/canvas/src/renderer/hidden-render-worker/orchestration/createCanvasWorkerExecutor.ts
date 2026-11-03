import type { CanvasWorkerRequest, CanvasWorkerResult } from '../../../shared/rendering';
import type { CanvasCard } from '../../../shared';
import { createPixiCanvasKernel, type CanvasRasterTile } from '../../kernel';
import { createHtmlCardRasterizer, resolveVisibleCardRegions } from '../../capabilities/textRasterization';
import { createCardSurface } from '../functions/createCardSurface';
import { createCanvasLayoutCache, measureCanvasCards, type CanvasLayoutCache } from '../functions/measureCanvasCards';

async function executeCanvasWorkerRequest(request: CanvasWorkerRequest, signal: AbortSignal, cache: CanvasLayoutCache): Promise<CanvasWorkerResult> {
  signal.throwIfAborted();
  const stage = document.createElement('div');
  const staging = document.createElement('div');
  stage.style.cssText = 'position:fixed;left:0;top:0';
  document.body.append(stage, staging);
  const rasterizer = createHtmlCardRasterizer({ host: staging });
  try {
    if (request.kind === 'measure' || request.kind === 'measureBatch') {
      const measured = await measureCanvasCards(request, stage, cache, signal);
      if (request.kind === 'measureBatch') return { status: 'measuredBatch', requestId: request.requestId, cards: measured };
      return { status: 'measured', requestId: request.requestId, width: request.width, height: measured[0].height };
    }
    const kernel = await createPixiCanvasKernel({ host: stage, width: request.width, height: request.height, resolution: request.dpr });
    try {
      kernel.setElements(request.snapshot.elements);
      kernel.setAppearance({ dark: request.theme === 'dark', material: request.material, overview: 'titles' });
      kernel.fit(request.region ? [request.region] : request.snapshot.elements.filter((element): element is CanvasCard => element.type !== 'edge'));
      const camera = kernel.readCamera();
      // 远景按产品规则显示标题；近景必须画正式正文，图片始终保留图像。
      for (const card of kernel.visibleCards()) {
        signal.throwIfAborted();
        if (camera.zoom < 0.3 && card.type !== 'image') continue;
        const element = createCardSurface(card, request);
        const scale = Math.max(0.25, camera.zoom * request.dpr);
        const tiles: CanvasRasterTile[] = [];
        const regions = resolveVisibleCardRegions({ cardX: card.x, cardY: card.y, cardWidth: card.width, cardHeight: card.height,
          worldLeft: -camera.x / camera.zoom, worldRight: (request.width - camera.x) / camera.zoom,
          worldTop: -camera.y / camera.zoom, worldBottom: (request.height - camera.y) / camera.zoom, scale });
        try {
          for (const { offsetX, offsetY, width, height } of regions) {
            const raster = await rasterizer.rasterize({ element, width: card.width, tileWidth: width, height, scale, offsetX, offsetY }, signal);
            tiles.push({ bitmap: raster.bitmap, x: offsetX, y: offsetY, width, height });
          }
        } catch (error) { tiles.forEach((tile) => tile.bitmap.close()); throw error; }
        kernel.setRasterTiles(card.id, card.revision, `worker:${request.snapshot.sequence}:${request.theme}:${scale}`, tiles);
      }
      signal.throwIfAborted();
      const dataUrl = await kernel.captureImage(request.format, request.quality);
      return { status: 'rendered', requestId: request.requestId, sequence: request.snapshot.sequence,
        width: Math.ceil(request.width * request.dpr), height: Math.ceil(request.height * request.dpr), format: request.format, dataUrl };
    } finally { kernel.destroy(); }
  } finally { rasterizer.dispose(); stage.remove(); staging.remove(); }
}

export function createCanvasWorkerExecutor() {
  const cache = createCanvasLayoutCache();
  return (request: CanvasWorkerRequest, signal: AbortSignal) => executeCanvasWorkerRequest(request, signal, cache);
}
