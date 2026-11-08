import type { CanvasCard, CanvasCardId, CanvasRectangle } from '../../../../shared';
import { CanvasResizeClip } from './CanvasResizeClip';
import type { CanvasCardView } from './definitions/canvasCardView';

export interface CanvasCardPreviewContext {
  readonly views: ReadonlyMap<CanvasCardId, CanvasCardView>;
  readonly cards: Map<CanvasCardId, CanvasCard>;
  /** 手势开始时的原卡；kernel 安装新快照时据此保留拖动中的显示位置。 */
  readonly originals: Map<CanvasCardId, CanvasCard>;
  freeze(ids: readonly CanvasCardId[]): void;
  /** 只改位置：交给场景动效写回容器。 */
  move(view: CanvasCardView): void;
  /** 改了尺寸：纸面、阴影与身份牌按新尺寸重新投影。 */
  resize(view: CanvasCardView): void;
}

/**
 * 拖动与改尺寸共用的显示副本：手势中只改副本，提交落地或取消后换回目标卡。
 * 改尺寸时正文仍是旧排版，由 CanvasResizeClip 裁在纸面内。
 */
export class CanvasCardPreview {
  private resizingId: CanvasCardId | null = null;
  private swapping: CanvasCardId | null = null;
  private readonly clip = new CanvasResizeClip();
  constructor(private readonly context: CanvasCardPreviewContext) {}

  /** 正在改尺寸的卡；其显示副本仍是旧修订，不能按它排版正文。 */
  get resizing(): CanvasCardId | null {
    return this.resizingId;
  }
  /** 返回这次是否是手势的第一帧。 */
  place(
    ids: readonly CanvasCardId[],
    place: (card: CanvasCard, original: CanvasCard) => void
  ): boolean {
    const { views, cards, originals } = this.context;
    this.context.freeze(ids);
    const starting = originals.size === 0;
    for (const id of ids) {
      const view = views.get(id);
      if (!view || view.card.locked) continue;
      if (!originals.has(id)) {
        originals.set(id, view.card);
        // 只在手势开始时复制绘制投影，后续 pointermove 不逐卡分配对象。
        view.card = { ...view.card };
        cards.set(id, view.card);
      }
      const original = originals.get(id);
      if (!original) continue;
      place(view.card, original);
      this.context.move(view);
    }
    return starting;
  }
  /** 从上边或左边拖时外框原点也会变，所以整框替换；正文旧排版贴着新左上角裁剪。 */
  resize(id: CanvasCardId, frame: CanvasRectangle): boolean {
    this.resizingId = id;
    const starting = this.place([id], card => {
      card.x = frame.x;
      card.y = frame.y;
      card.width = frame.width;
      card.height = frame.height;
    });
    const view = this.context.views.get(id);
    if (view) this.context.resize(view);
    this.clip.fit(view);
    return starting;
  }
  /** 换回目标卡，返回已恢复的卡供空间索引更新。 */
  restore(targets: ReadonlyMap<CanvasCardId, CanvasCard>): CanvasCard[] {
    const { views, cards, originals } = this.context;
    const restored: CanvasCard[] = [];
    for (const id of originals.keys()) {
      const target = targets.get(id),
        view = views.get(id);
      if (!target || !view) continue;
      cards.set(id, target);
      view.card = target;
      if (id === this.resizingId) this.context.resize(view);
      else this.context.move(view);
      restored.push(target);
    }
    originals.clear();
    this.swapping = this.resizingId ?? this.swapping;
    this.resizingId = null;
    this.clip.refit();
    return restored;
  }
  /** 新正文装上时旧排版仍在交叉淡出；遮罩按卡片当前尺寸重新贴合，撤销改尺寸时也不会裁掉正文。 */
  contentInstalled(id: CanvasCardId): void {
    this.clip.refit(id);
  }
  /** 改尺寸后的第一份新正文：返回 true 时调用方先撤掉旧排版，不做交叉淡变。 */
  takeSwap(id: CanvasCardId): boolean {
    if (this.swapping !== id) return false;
    this.swapping = null;
    return true;
  }
  destroy(): void {
    this.clip.destroy();
  }
}
