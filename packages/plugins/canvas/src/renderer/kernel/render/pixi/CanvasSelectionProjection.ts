import { Graphics } from 'pixi.js';
import { canvasStandaloneChrome } from './canvasStandaloneChrome';
import type { CanvasCard, CanvasCardId, CanvasRectangle } from '../../../../shared';
import type {
  CanvasAppearance,
  CanvasGuide,
  CanvasSelectionFrame,
} from '../../definitions/canvasKernel';
import {
  CANVAS_SELECTION_OUTLINE,
  type CanvasSelectionOutline,
} from '../../geometry/canvasCardFrame';

/** 用户框选与吸附导线共用世界坐标图层，不拥有卡片选择规则或持久状态。 */
export class CanvasSelectionProjection {
  readonly selectionLayer = new Graphics();
  readonly guideLayer = new Graphics();
  private guides: readonly CanvasGuide[] = [];
  private brush: CanvasRectangle | null = null;
  private accent = 0x347b45;
  private outlineStyle: CanvasSelectionOutline = CANVAS_SELECTION_OUTLINE.paper;
  private frame: CanvasSelectionFrame | null = null;
  /** 读取内核的实时卡片与选择集，不拥有、不复制它们。 */
  constructor(
    private readonly cards: ReadonlyMap<CanvasCardId, CanvasCard>,
    private readonly selected: ReadonlySet<CanvasCardId>
  ) {}
  /** 主题色与随卡片材质变化的描边样式，见 CANVAS_SELECTION_OUTLINE。 */
  setAppearance(appearance: CanvasAppearance): void {
    this.accent = (appearance.chrome ?? canvasStandaloneChrome(appearance.dark)).accent;
    this.outlineStyle = CANVAS_SELECTION_OUTLINE[appearance.material];
  }
  /** 编辑实测高度、新建草稿与改尺寸预览的外框，覆盖对应卡的存储外框。 */
  setFrame(frame: CanvasSelectionFrame | null): void {
    this.frame = frame;
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
  /** 选中、编辑、新建草稿与改尺寸预览都经这里画描边。 */
  drawSelection(zoom: number): void {
    const { cards, selected, frame } = this;
    this.selectionLayer.clear();
    if (this.brush)
      this.selectionLayer
        .rect(this.brush.x, this.brush.y, this.brush.width, this.brush.height)
        .fill({ color: this.accent, alpha: 0.08 })
        .stroke({ width: 1 / zoom, color: this.accent, alpha: 0.6 });
    const { inset, radius, width, halo } = this.outlineStyle;
    const line = width / zoom,
      glow = halo / zoom;
    // alignment 0 向外描边：线不进纸面，编辑时 DOM 叠层盖住纸面也不会遮掉半条线。
    const outline = (box: CanvasRectangle) => {
      const x = box.x + inset,
        y = box.y + inset,
        w = box.width - inset * 2,
        h = box.height - inset * 2;
      this.selectionLayer
        .roundRect(x, y, w, h, radius)
        .stroke({ width: line, color: this.accent, alignment: 0 });
      if (glow > 0)
        this.selectionLayer
          .roundRect(x - line, y - line, w + line * 2, h + line * 2, radius + line)
          .stroke({ width: glow, color: this.accent, alpha: 0.18, alignment: 0 });
    };
    for (const id of selected) {
      const box = frame?.id === id ? frame.rectangle : cards.get(id);
      if (box) outline(box);
    }
    if (frame && (frame.id === null || !selected.has(frame.id))) outline(frame.rectangle);
  }
}
