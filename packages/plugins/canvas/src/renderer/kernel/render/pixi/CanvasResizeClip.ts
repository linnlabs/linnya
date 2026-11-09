import { Graphics } from 'pixi.js';
import type { CanvasCardId } from '../../../../shared';
import type { CanvasCardView } from './definitions/canvasCardView';

/**
 * 实时改尺寸期间及松手后的交叉淡变里，正文位图仍有旧宽度的排版：纸面缩小时会溢出卡外。
 * 只给最近改过尺寸的那一张卡加矩形遮罩，始终贴合其当前纸面；换卡时移交。
 * 不给全部卡片常驻遮罩，避免模板缓冲开销。
 */
export class CanvasResizeClip {
  private view: CanvasCardView | null = null;
  private mask: Graphics | null = null;

  /** 让遮罩贴合卡片当前显示尺寸；换了卡片时先撤掉旧卡的遮罩。 */
  fit(view: CanvasCardView | undefined): void {
    if (!view) return;
    if (this.view && this.view !== view) this.release();
    // 图片卡自带纸面遮罩（圆角、内缩），它本身就随卡片尺寸重画，不再叠一层矩形。
    if (view.paperClip && !view.paperClip.destroyed) {
      view.body.mask = view.paperClip;
      this.view = view;
      return;
    }
    if (!this.mask || this.mask.destroyed) this.mask = new Graphics();
    if (this.mask.parent !== view.container) view.container.addChild(this.mask);
    view.body.mask = this.mask;
    this.view = view;
    this.mask.clear().rect(0, 0, view.card.width, view.card.height).fill(0xffffff);
  }
  /** 按卡片当前尺寸重新贴合；给定 id 时只处理那张卡。 */
  refit(id?: CanvasCardId): void {
    if (!this.view || (id !== undefined && this.view.card.id !== id)) return;
    if (this.view.container.destroyed) this.view = null;
    else this.fit(this.view);
  }
  private release(): void {
    if (this.view && !this.view.container.destroyed)
      this.view.body.mask = this.view.paperClip?.destroyed ? null : this.view.paperClip;
    this.mask?.removeFromParent();
    this.view = null;
  }
  destroy(): void {
    this.mask?.destroy();
    this.mask = null;
    this.view = null;
  }
}
