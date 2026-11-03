import { Sprite, Texture } from 'pixi.js';
import { readCanvasCardCssPalette, readCanvasElementText, type CanvasCamera, type CanvasCard } from '../../../../shared';

/** 地图标签在屏幕分辨率的单一图层绘制，不生成 1/zoom 倍的巨型文字纹理。 */
export class CanvasMapLabels {
  readonly sprite: Sprite;
  private readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: Texture;
  private projection: { readonly cards: readonly CanvasCard[]; readonly camera: CanvasCamera; readonly width: number; readonly height: number; readonly dark: boolean } | undefined;
  private readonly padding = 160;
  private readonly fittedTitles = new Map<string, string>();

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
    readonly readTitle?: (card: CanvasCard) => string;
  }): void {
    this.sprite.visible = input.visible;
    if (!input.visible) return;
    const { width, height, camera } = input;
    const previous = this.projection;
    if (previous && previous.cards === input.cards && previous.camera.zoom === camera.zoom
      && previous.width === width && previous.height === height && previous.dark === input.dark
      && Math.abs(camera.x - previous.camera.x) < this.padding && Math.abs(camera.y - previous.camera.y) < this.padding) {
      // 同倍率平移只移动同一份屏幕排版；预留边界让新进入视口的标签也已在纹理中。
      this.sprite.position.set(camera.x - previous.camera.x - this.padding, camera.y - previous.camera.y - this.padding);
      return;
    }
    const renderWidth = width + this.padding * 2, renderHeight = height + this.padding * 2;
    if (this.canvas.width !== renderWidth || this.canvas.height !== renderHeight) {
      this.canvas.width = Math.max(1, renderWidth); this.canvas.height = Math.max(1, renderHeight);
    }
    const context = this.context;
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const fontSize = camera.zoom < 0.15 ? 12 : 13;
    context.font = `${fontSize}px system-ui`;
    context.textBaseline = 'top';
    const occupied = new Set<string>();
    for (const card of input.cards) {
      const x = card.x * camera.zoom + camera.x + this.padding;
      const y = card.y * camera.zoom + camera.y + this.padding;
      if (x > renderWidth || y > renderHeight || x + card.width * camera.zoom < 0 || y + card.height * camera.zoom < 0) continue;
      const key = `${Math.floor(x / 150)}:${Math.floor(y / 24)}`;
      if (occupied.has(key)) continue;
      occupied.add(key);
      const source = (input.readTitle?.(card) ?? readCanvasElementText(card)).split('\n')[0].slice(0, 18) || '空白卡片';
      const titleKey = `${fontSize}:${source}`;
      let title = this.fittedTitles.get(titleKey);
      if (title === undefined) {
        title = source;
        while (title.length > 1 && context.measureText(title).width > 140) title = title.slice(0, -1);
        // 标题缓存也要有界，不能随历史正文永久增长。
        if (this.fittedTitles.size >= 4096) this.fittedTitles.clear();
        this.fittedTitles.set(titleKey, title);
      }
      context.fillStyle = readCanvasCardCssPalette(card.color, input.dark).title;
      context.fillText(title, x + 2, y + 2);
    }
    this.texture.source.update();
    this.sprite.width = renderWidth; this.sprite.height = renderHeight;
    this.sprite.position.set(-this.padding, -this.padding);
    this.projection = { cards: input.cards, camera: { ...camera }, width, height, dark: input.dark };
  }

  invalidate(): void { this.projection = undefined; }

  destroy(): void { this.sprite.destroy(); this.texture.destroy(true); }
}
