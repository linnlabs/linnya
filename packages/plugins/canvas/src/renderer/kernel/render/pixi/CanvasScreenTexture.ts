import { CanvasSource, Sprite, Texture } from 'pixi.js';

/**
 * 屏幕坐标的 2D 文字层：同一块离屏 canvas 改尺寸后，Pixi 8.22 复用的纹理会和内容错位或整层消失，
 * 所以像素尺寸一变就换新纹理；同尺寸重画只上传内容。
 */
export class CanvasScreenTexture {
  readonly sprite = new Sprite();
  readonly canvas = document.createElement('canvas');
  readonly context: CanvasRenderingContext2D;
  private texture: Texture | null = null;

  constructor() {
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('canvas_2d_unavailable');
    this.context = context;
  }

  /** 按物理像素准备画布；返回的上下文已清空，变换为单位矩阵。 */
  prepare(pixelWidth: number, pixelHeight: number): CanvasRenderingContext2D {
    const width = Math.max(1, Math.ceil(pixelWidth)),
      height = Math.max(1, Math.ceil(pixelHeight));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.replaceTexture();
    } else {
      this.context.setTransform(1, 0, 0, 1, 0, 0);
      this.context.clearRect(0, 0, width, height);
    }
    return this.context;
  }

  /** 上传本次绘制，并把精灵铺到给定的显示尺寸。 */
  commit(displayWidth: number, displayHeight: number): void {
    if (!this.texture) this.replaceTexture();
    this.texture?.source.update();
    this.sprite.width = displayWidth;
    this.sprite.height = displayHeight;
  }

  private replaceTexture(): void {
    const previous = this.texture;
    this.texture = new Texture({ source: new CanvasSource({ resource: this.canvas }) });
    this.sprite.texture = this.texture;
    previous?.destroy(true);
  }

  destroy(): void {
    this.sprite.destroy();
    this.texture?.destroy(true);
    this.texture = null;
  }
}
