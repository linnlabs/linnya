import { disposeDocumentPreviewSurface } from '@linnya/document-preview';
import type { CanvasCard } from '../../../../shared';
import type { CardRasterizer, CardRasterRequest } from '../../../capabilities/textRasterization';
import type {
  CanvasCardRasterInput,
  CanvasCardRasterOutput,
} from '../definitions/canvasCardRasterization';
import { createCanvasRasterDom } from '../functions/createCanvasRasterDom';
import { installCanvasCardInk } from '../functions/installCanvasCardInk';

const CLIPPED_TOLERANCE = 1;

type Prepared =
  | { readonly kind: 'ready'; readonly input: CanvasCardRasterInput; readonly element: HTMLElement }
  | { readonly kind: 'failed'; readonly error: unknown };
export function createCanvasCardRasterBatch(options: {
  readonly rasterizer: CardRasterizer;
  readonly createContent?: (card: CanvasCard, signal: AbortSignal) => Promise<HTMLElement>;
}) {
  return async (
    inputs: readonly CanvasCardRasterInput[],
    signal: AbortSignal
  ): Promise<readonly CanvasCardRasterOutput[]> => {
    const prepared: Prepared[] = [];
    try {
    for (const input of inputs) {
      try {
        signal.throwIfAborted();
        const element = options.createContent
          ? await options.createContent(input.card, signal)
          : createCanvasRasterDom(input);
        if (input.card.type !== 'document')
          element.classList.add('markdown-document-content', 'canvas-card-content');
        installCanvasCardInk(element, input.card.color, input.dark);
        prepared.push({ kind: 'ready', input, element });
      } catch (error) {
        signal.throwIfAborted();
        prepared.push({ kind: 'failed', error });
      }
    }
    const textItems = prepared.flatMap((item, index) =>
      item.kind === 'ready' && item.input.card.type === 'text' ? [{ item, index }] : []
    );
    const measurements = await options.rasterizer.measureBatch(
      textItems.map(({ item }) => ({ element: item.element, width: item.input.card.width })),
      signal
    );
    measurements.forEach((measurement, position) => {
      const { index, item } = textItems[position];
      if (measurement.status === 'rejected') {
        prepared[index] = { kind: 'failed', error: measurement.reason };
        return;
      }
      // 自动适配的卡高按三位小数保存，实测排版会多出零点零几像素；不足1px的差不算截断，否则会给完整正文画上淡出。
      item.element.classList.toggle(
        'canvas-card-content-clipped',
        measurement.value - item.input.card.height >= CLIPPED_TOLERANCE
      );
      item.element.style.position = 'relative';
      item.element.style.height = `${item.input.card.height}px`;
    });
    const requests: CardRasterRequest[] = prepared.flatMap(item =>
      item.kind === 'failed'
        ? []
        : item.input.regions.map(region => ({
            element: item.element,
            width: item.input.card.width,
            height: region.height,
            scale: item.input.scale,
            tileWidth: region.width,
            offsetX: region.x,
            offsetY: region.y,
          }))
    );
    const rasters = await options.rasterizer.rasterizeBatch(requests, signal);
    let cursor = 0;
    return prepared.map(item => {
      if (item.kind === 'failed') return item;
      const tiles = item.input.regions.map(region => ({
        bitmap: rasters[cursor++].bitmap,
        scale: item.input.scale,
        ...region,
      }));
      return { kind: 'ready', tiles };
    });
    } finally {
      for (const item of prepared) if (item.kind === 'ready') disposeDocumentPreviewSurface(item.element);
    }
  };
}
