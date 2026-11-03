import type { CanvasWorkerRequest, CanvasWorkerResult } from '../../../shared/rendering';
import type { CanvasCard } from '../../../shared';
import { createPixiCanvasKernel } from '../../kernel';
import { createHtmlCardRasterizer, splitCardRasterRegions } from '../../capabilities/textRasterization';
import { createCanvasCardRasterBatch } from '../../features/cardRendering';
import { resolveCanvasDisplayImages } from '../../features/cardRendering/content';
import { createCardSurface } from '../functions/createCardSurface';
import { createCanvasLayoutCache, measureCanvasCards, type CanvasLayoutCache } from '../functions/measureCanvasCards';

async function executeCanvasWorkerRequest(input: CanvasWorkerRequest, signal: AbortSignal, cache: CanvasLayoutCache): Promise<CanvasWorkerResult> {
  signal.throwIfAborted();
  const request: CanvasWorkerRequest = { ...input, assets: await resolveCanvasDisplayImages(input.assets, signal) };
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
    const kernel = await createPixiCanvasKernel({ host: stage, width: request.width, height: request.height, resolution: request.dpr, renderingMode: 'capture' });
    try {
      kernel.setElements(request.snapshot.elements);
      kernel.setDocumentTitles(new Map(Object.entries(request.documents).map(([id, presentation]) => [id, presentation.title])));
      kernel.setThumbnailCards(new Set(request.snapshot.elements.filter((element): element is CanvasCard => element.type === 'document' && request.documents[element.data.documentId]?.keepThumbnail === true).map(card => card.id)));
      kernel.setAppearance({ dark: request.theme === 'dark', material: request.material, overview: 'titles' });
      kernel.fit(request.region ? [request.region] : request.snapshot.elements.filter((element): element is CanvasCard => element.type !== 'edge'));
      const camera = kernel.readCamera();
      const cards = kernel.rasterCards();
      const renderBatch = createCanvasCardRasterBatch({ rasterizer, createContent: async card => createCardSurface(card, request) });
      const scale = Math.max(0.25, camera.zoom * request.dpr);
      // 前后台使用同一正文测高、裁切提示和批量paint，不另写一套逐片正文路径。
      for (let start = 0; start < cards.length; start += 32) {
        signal.throwIfAborted();
        const batch = cards.slice(start, start + 32);
        const results = await renderBatch(batch.map(card => ({ card, dark: request.theme === 'dark', scale, regions: splitCardRasterRegions(kernel.readVisibleCardRegions(card.id), scale) })), signal);
        const failed = results.find(result => result.kind === 'failed');
        if (failed) { for (const result of results) if (result.kind === 'ready') for (const tile of result.tiles) tile.bitmap.close(); throw failed.error; }
        results.forEach((result, index) => {
          if (result.kind === 'ready') kernel.setRasterTiles(batch[index].id, batch[index].revision, `worker:${request.snapshot.sequence}:${request.theme}:${scale}`, result.tiles);
        });
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
