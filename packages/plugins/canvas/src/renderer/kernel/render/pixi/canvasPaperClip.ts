import { Graphics } from 'pixi.js';
import {
  CANVAS_CARD_CORNER_RADIUS,
  CANVAS_CARD_PAPER_INSET,
  type CanvasCardMaterial,
} from '../../geometry/canvasCardFrame';
import type { CanvasCardView } from './definitions/canvasCardView';

/**
 * 图片卡的纸面遮罩：位图铺满卡片几何框，看得见的纸面却内缩 PAPER_INSET 并带圆角；
 * 不裁的话图片会露出纸外、四角是直角，选中描边也压进图片里。遮罩与纸面同一外框。
 */
export function fitCanvasPaperClip(view: CanvasCardView, material: CanvasCardMaterial): void {
  if (view.card.type !== 'image') return;
  if (!view.paperClip || view.paperClip.destroyed) view.paperClip = new Graphics();
  if (view.paperClip.parent !== view.container) view.container.addChild(view.paperClip);
  const inset = CANVAS_CARD_PAPER_INSET;
  view.paperClip
    .clear()
    .roundRect(
      inset,
      inset,
      Math.max(0, view.card.width - inset * 2),
      Math.max(0, view.card.height - inset * 2),
      CANVAS_CARD_CORNER_RADIUS[material]
    )
    .fill(0xffffff);
  // 改尺寸期间的临时遮罩由 CanvasResizeClip 持有，松手后再交回纸面遮罩。
  if (!view.body.mask) view.body.mask = view.paperClip;
}
