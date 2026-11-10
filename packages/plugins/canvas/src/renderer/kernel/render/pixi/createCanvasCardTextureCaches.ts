import type { CanvasCardId } from '../../../../shared';
import { CanvasBitmapCache } from './CanvasBitmapCache';
import { CanvasIdentityAtlas } from './CanvasIdentityAtlas';

/** 只组合两个纹理owner的准入，不拥有排版、UI、GL绘制或正文事实。 */
export function createCanvasCardTextureCaches(options: {
  readonly textureBudgetBytes: number;
  readonly bitmapBudgetBytes: number;
  readonly readRenderCount: () => number;
  readonly requestDraw: () => void;
  readonly changed: (id: CanvasCardId) => void;
}) {
  // 两个构造函数不发起分配；所有互相让位都发生在构造完成后的显式接纳批次。
  const identities = new CanvasIdentityAtlas({
    budget: options.textureBudgetBytes,
    reserve: bytes => bitmaps.trimTo(options.textureBudgetBytes - bytes),
  });
  const bitmaps = new CanvasBitmapCache({
    budget: options.bitmapBudgetBytes,
    readAvailableBudget: () => options.textureBudgetBytes - identities.readBytes(),
    reserveExternal: (incoming, current) =>
      identities.trimTo(
        options.textureBudgetBytes - Math.min(options.bitmapBudgetBytes, current + incoming)
      ),
    readRenderCount: options.readRenderCount,
    requestDraw: options.requestDraw,
    changed: options.changed,
  });
  return { identities, bitmaps };
}
