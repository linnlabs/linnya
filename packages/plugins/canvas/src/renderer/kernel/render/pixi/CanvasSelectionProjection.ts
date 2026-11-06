import { Graphics } from 'pixi.js';
import type { CanvasCard, CanvasCardId, CanvasRectangle } from '../../../../shared';
import type { CanvasGuide } from '../../definitions/canvasKernel';

/** 用户框选与吸附导线共用世界坐标图层，不拥有卡片选择规则或持久状态。 */
export class CanvasSelectionProjection {
  readonly selectionLayer = new Graphics();
  readonly guideLayer = new Graphics();
  private guides: readonly CanvasGuide[] = [];
  private brush: CanvasRectangle | null = null;
  private accent = 0x347b45;
  setAccent(accent: number): void {
    this.accent = accent;
  }
  setGuides(guides: readonly CanvasGuide[]): void {
    this.guides = guides;
  }
  setBrush(brush: CanvasRectangle | null): void {
    this.brush = brush;
  }
  drawGuides(zoom: number): void {
    this.guideLayer.clear();
    for (const guide of this.guides)
      this.guideLayer.moveTo(guide.from.x, guide.from.y).lineTo(guide.to.x, guide.to.y);
    this.guideLayer.stroke({ width: 1 / zoom, color: this.accent, alpha: 0.75 });
  }
  drawSelection(
    cards: ReadonlyMap<CanvasCardId, CanvasCard>,
    selected: ReadonlySet<CanvasCardId>,
    zoom: number
  ): void {
    this.selectionLayer.clear();
    if (this.brush)
      this.selectionLayer
        .rect(this.brush.x, this.brush.y, this.brush.width, this.brush.height)
        .fill({ color: this.accent, alpha: 0.08 })
        .stroke({ width: 1 / zoom, color: this.accent, alpha: 0.6 });
    for (const id of selected) {
      const card = cards.get(id);
      if (card)
        this.selectionLayer
          .roundRect(card.x, card.y, card.width, card.height, 4)
          .stroke({ width: 1.5 / zoom, color: this.accent });
    }
  }
}
