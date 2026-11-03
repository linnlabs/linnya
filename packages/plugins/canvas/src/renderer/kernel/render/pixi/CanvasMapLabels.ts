import { Sprite, Texture } from 'pixi.js';
import { readCanvasElementText, type CanvasCamera, type CanvasCard } from '../../../../shared';

/** 地图标签在屏幕分辨率的单一图层绘制，不生成 1/zoom 倍的巨型文字纹理。 */
export class CanvasMapLabels {
  readonly sprite: Sprite;
  private readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: Texture;

  constructor() {
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('canvas_2d_unavailable');
    this.context = context;
    this.texture = Texture.from(this.canvas);
    this.sprite = new Sprite(this.texture);
  }

  draw(input: {
    readonly cards: readonly CanvasCard[];
    readonly camera: CanvasCamera;
    readonly width: number;
    readonly height: number;
    readonly dark: boolean;
    readonly visible: boolean;
  }): void {
    this.sprite.visible = input.visible;
    if (!input.visible) return;
    const { width, height, camera } = input;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = Math.max(1, width); this.canvas.height = Math.max(1, height);
    }
    const context = this.context;
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    context.font = `${camera.zoom < 0.15 ? 12 : 13}px system-ui`;
    context.fillStyle = input.dark ? '#e8e9e3' : '#252c27';
    context.textBaseline = 'top';
    const occupied = new Set<string>();
    for (const card of input.cards) {
      const x = card.x * camera.zoom + camera.x;
      const y = card.y * camera.zoom + camera.y;
      if (x > width || y > height || x + card.width * camera.zoom < 0 || y + card.height * camera.zoom < 0) continue;
      const key = `${Math.floor(x / 150)}:${Math.floor(y / 24)}`;
      if (occupied.has(key)) continue;
      occupied.add(key);
      let title = readCanvasElementText(card).split('\n')[0].slice(0, 18) || '空白卡片';
      while (title.length > 1 && context.measureText(title).width > 140) title = title.slice(0, -1);
      context.fillText(title, x + 2, y + 2);
    }
    this.texture.source.update();
    this.sprite.width = width; this.sprite.height = height;
  }

  destroy(): void { this.sprite.destroy(); this.texture.destroy(true); }
}
