import { createMarkdownDocumentFragment } from '@linnya/markdown-document-core';
import { JsonValueSchema } from '@app/schemas';
import type { CanvasMeasureBatchRequest, CanvasMeasureRequest } from '../../../shared/rendering';
import { installTypography } from './createCardSurface';
import { hydrateEmbeddedImages } from './hydrateEmbeddedImages';

export interface CanvasLayoutCache {
  get(key: string): number | undefined;
  set(key: string, height: number): void;
}

/** 只缓存有界的尺寸事实；精确正文序列作 key，不能用可能碰撞的临时 hash 猜相同内容。 */
export function createCanvasLayoutCache(): CanvasLayoutCache {
  const heights = new Map<string, number>();
  let bytes = 0;
  return {
    get(key) {
      const value = heights.get(key);
      if (value !== undefined) { heights.delete(key); heights.set(key, value); }
      return value;
    },
    set(key, height) {
      if (heights.has(key) || key.length * 2 > 8 * 1024 * 1024) return;
      while (heights.size >= 512 || bytes + key.length * 2 > 8 * 1024 * 1024) {
        const oldest = heights.keys().next();
        if (oldest.done) break;
        bytes -= oldest.value.length * 2; heights.delete(oldest.value);
      }
      heights.set(key, height); bytes += key.length * 2;
    },
  };
}

export async function measureCanvasCards(
  request: CanvasMeasureBatchRequest | CanvasMeasureRequest,
  stage: HTMLElement,
  cache: CanvasLayoutCache,
  signal: AbortSignal,
) {
  const cards = request.kind === 'measureBatch' ? request.cards : [{ ref: request.requestId, contentVersion: 1, width: request.width, content: request.content }];
  const pending = new Map<string, HTMLElement>();
  const keys: string[] = [];
  const measured = new Map<string, number>();
  const availableAssets = Object.keys(request.assets).sort();
  for (const card of cards) {
    signal.throwIfAborted();
    const key = JSON.stringify([card.contentVersion, card.content, card.width, request.fontFamily, request.fontSize, request.theme, request.dpr, request.uiScale, availableAssets]);
    keys.push(key);
    const cached = cache.get(key);
    if (cached !== undefined) { measured.set(key, cached); continue; }
    if (pending.has(key)) continue;
    const surface = document.createElement('div');
    surface.className = 'markdown-document-content';
    surface.style.cssText = `box-sizing:border-box;padding:16px 18px 18px;overflow-wrap:anywhere;width:${card.width}px`;
    installTypography(surface, request);
    surface.append(createMarkdownDocumentFragment(JsonValueSchema.parse(card.content), document));
    hydrateEmbeddedImages(surface, request.assets);
    stage.append(surface); pending.set(key, surface);
  }
  await document.fonts.ready;
  await Promise.all(Array.from(stage.querySelectorAll('img'), async (image) => {
    if (!image.src.startsWith('data:') && !image.src.startsWith('blob:')) throw new Error('resource_unavailable');
    await image.decode();
  }));
  signal.throwIfAborted();
  // 所有 DOM 先安装再集中读取，避免每卡写入/读取交替触发布局。
  for (const [key, surface] of pending) {
    const height = Math.max(1, surface.getBoundingClientRect().height);
    measured.set(key, height); cache.set(key, height);
  }
  return cards.map((card, index) => {
    const height = measured.get(keys[index]) ?? cache.get(keys[index]);
    if (height === undefined) throw new Error('measurement_missing');
    return { ref: card.ref, width: card.width, height };
  });
}
