import type { CanvasCard } from '../../../../shared';
import type { CardRasterizer, CardRasterRequest } from '../../../capabilities/textRasterization';
import type { CanvasCardRasterInput, CanvasCardRasterOutput } from '../definitions/canvasCardRasterization';
import { createCanvasRasterDom } from '../functions/createCanvasRasterDom';

type Prepared = { readonly kind: 'ready'; readonly input: CanvasCardRasterInput; readonly element: HTMLElement }
  | { readonly kind: 'failed'; readonly error: unknown };
export function createCanvasCardRasterBatch(options: {
  readonly rasterizer: CardRasterizer;
  readonly createContent?: (card: CanvasCard, signal: AbortSignal) => Promise<HTMLElement>;
}) {
  return async (inputs: readonly CanvasCardRasterInput[], signal: AbortSignal): Promise<readonly CanvasCardRasterOutput[]> => {
    const prepared: Prepared[] = [];
    for (const input of inputs) {
      try {
        signal.throwIfAborted();
        const element = options.createContent ? await options.createContent(input.card, signal) : createCanvasRasterDom(input);
        element.classList.add('markdown-document-content', 'canvas-card-content'); element.style.color = input.dark ? '#e8e9e3' : '#252c27';
        if (input.card.type === 'text') {
          const contentHeight = await options.rasterizer.measure(element, input.card.width, signal);
          element.classList.toggle('canvas-card-content-clipped', contentHeight > input.card.height);
          element.style.position = 'relative'; element.style.height = `${input.card.height}px`;
        }
        prepared.push({ kind: 'ready', input, element });
      } catch (error) { signal.throwIfAborted(); prepared.push({ kind: 'failed', error }); }
    }
    const requests: CardRasterRequest[] = prepared.flatMap(item => item.kind === 'failed' ? [] : item.input.regions.map(region => ({
      element: item.element, width: item.input.card.width, height: region.height, scale: item.input.scale,
      tileWidth: region.width, offsetX: region.x, offsetY: region.y,
    })));
    const rasters = await options.rasterizer.rasterizeBatch(requests, signal);
    let cursor = 0;
    return prepared.map(item => {
      if (item.kind === 'failed') return item;
      const tiles = item.input.regions.map(region => ({ bitmap: rasters[cursor++].bitmap, ...region }));
      return { kind: 'ready', tiles };
    });
  };
}
