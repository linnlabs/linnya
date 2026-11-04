import { Sprite, Texture } from 'pixi.js';
import { readCanvasCardCssPalette, readCanvasElementText, type CanvasCard } from '../../../../shared';
import type { CanvasMapLabelsInput, CanvasMapLabelsProjection } from '../../definitions/canvasMapLabels';
import { canvasTextGraphemes, canvasTitlePrefix } from '../../geometry/canvasTextGraphemes';

/** 地图标签在屏幕分辨率的单一图层绘制，不生成 1/zoom 倍的巨型文字纹理。 */
export class CanvasMapLabels {
  readonly sprite: Sprite;
  private readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: Texture;
  private projection: CanvasMapLabelsProjection | undefined;
  private readonly padding = 160;
  private readonly drawn = new Set<CanvasCard['id']>();
  private readonly fittedTitles = new Map<string, string>();

  constructor() {
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('canvas_2d_unavailable');
    this.context = context;
    this.texture = Texture.from(this.canvas);
    this.sprite = new Sprite(this.texture);
  }

  private panCachedProjection(input: CanvasMapLabelsInput): boolean {
    const { width, height, camera } = input;
    const previous = this.projection;
    if (previous && previous.cards === input.cards && previous.camera.zoom === camera.zoom
      && previous.width === width && previous.height === height && previous.dark === input.dark
      && Math.abs(camera.x - previous.camera.x) < this.padding && Math.abs(camera.y - previous.camera.y) < this.padding) {
      // 同倍率平移只移动同一份屏幕排版；预留边界让新进入视口的标签也已在纹理中。
      this.sprite.position.set(camera.x - previous.camera.x - this.padding, camera.y - previous.camera.y - this.padding);
      return true;
    }
    return false;
  }
  private title(card: CanvasCard, readTitle: CanvasMapLabelsInput['readTitle'], fontSize: number): string {
    const source = canvasTitlePrefix(readTitle?.(card) ?? readCanvasElementText(card), 18) || '空白卡片';
    const titleKey = `${fontSize}:${source}`, existing = this.fittedTitles.get(titleKey);
    if (existing !== undefined) return existing;
    const graphemes = Array.from(canvasTextGraphemes(source)); let title = source;
    // 地图标签沿用不加省略号、至少保留一组字形的规则，裁尾也不能拆开组合序列。
    while (graphemes.length > 1 && this.context.measureText(title).width > 140) { graphemes.pop(); title = graphemes.join(''); }
    // 标题缓存也要有界，不能随历史正文永久增长。
    if (this.fittedTitles.size >= 4096) this.fittedTitles.clear();
    this.fittedTitles.set(titleKey, title); return title;
  }
  private needsRedraw(input: CanvasMapLabelsInput): boolean {
    this.sprite.visible = input.visible && input.cards.length > 0;
    if (!input.cards.length) {
      // 纯图片/缩略图没有标题候选，不能每次缩放上传整张透明屏幕纹理。
      // 清投影身份，回到非空时即使复用旧cards数组也必须重画当前文字。
      this.drawn.clear(); this.projection = undefined; return false;
    }
    return input.visible && !this.panCachedProjection(input);
  }
  draw(input: CanvasMapLabelsInput): void {
    if (!this.needsRedraw(input)) return;
    const { width, height, camera } = input;
    const renderWidth = width + this.padding * 2, renderHeight = height + this.padding * 2;
    if (this.canvas.width !== renderWidth || this.canvas.height !== renderHeight) {
      this.canvas.width = Math.max(1, renderWidth); this.canvas.height = Math.max(1, renderHeight);
    }
    const context = this.context;
    context.clearRect(0, 0, this.canvas.width, this.canvas.height); this.drawn.clear();
    const fontSize = camera.zoom < 0.15 ? 12 : 13;
    context.font = `${fontSize}px system-ui`;
    context.textBaseline = 'top';
    const occupied = new Set<string>();
    for (const card of input.cards) {
      const opacity = input.readOpacity?.(card.id) ?? 1; if (opacity <= 0) continue;
      const x = card.x * camera.zoom + camera.x + this.padding;
      const y = card.y * camera.zoom + camera.y + this.padding;
      if (x > renderWidth || y > renderHeight || x + card.width * camera.zoom < 0 || y + card.height * camera.zoom < 0) continue;
      const key = `${Math.floor(x / 150)}:${Math.floor(y / 24)}`;
      if (occupied.has(key)) continue;
      occupied.add(key);
      context.globalAlpha = opacity; this.drawn.add(card.id);
      context.fillStyle = readCanvasCardCssPalette(card.color, input.dark).title;
      context.fillText(this.title(card, input.readTitle, fontSize), x + 2, y + 2);
    }
    context.globalAlpha = 1;
    this.texture.source.update();
    this.sprite.width = renderWidth; this.sprite.height = renderHeight;
    this.sprite.position.set(-this.padding, -this.padding);
    this.projection = { cards: input.cards, camera: { ...camera }, width, height, dark: input.dark };
  }

  hasLabel(id: CanvasCard['id']): boolean { return this.drawn.has(id); }

  invalidate(): void { this.projection = undefined; }

  destroy(): void { this.sprite.destroy(); this.texture.destroy(true); }
}
