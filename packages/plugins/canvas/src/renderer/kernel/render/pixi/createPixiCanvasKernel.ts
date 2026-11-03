// Pixi 的静态 uniform polyfill 支持严格 CSP；不放开 script-src unsafe-eval。
import 'pixi.js/unsafe-eval';
import { Application, Container, Graphics, NineSliceSprite, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import {
  canvasBounds, canvasScreenToWorld, canvasWorldToScreen, readCanvasElementText,
  type CanvasCamera, type CanvasCard, type CanvasCardId, type CanvasColor,
  type CanvasEdge, type CanvasElement, type CanvasPoint, type CanvasRectangle,
} from '../../../../shared';
import type { CanvasAppearance, CanvasKernel, CanvasKernelIntent, CanvasRasterTile } from '../../definitions/canvasKernel';
import { canvasEdgePoints } from '../../geometry/canvasEdgeGeometry';
import { installCanvasInteraction } from '../../interaction/installCanvasInteraction';
import { CanvasMapLabels } from './CanvasMapLabels';

interface CardView { readonly card: CanvasCard; readonly container: Container; readonly background: NineSliceSprite; readonly body: Container; readonly label: Text }
interface BitmapEntry { readonly key: string; readonly resources: readonly { readonly texture: Texture; readonly bitmap: ImageBitmap }[]; readonly bytes: number }
const LIGHT: Record<CanvasColor, number> = { white: 0xfbfaf5, red: 0xf5e4e1, orange: 0xf7e9dc, yellow: 0xf6f0d8, green: 0xe6ecdf, cyan: 0xe1edf0, purple: 0xeee7ef };
const DARK: Record<CanvasColor, number> = { white: 0x323631, red: 0x4a3634, orange: 0x493c30, yellow: 0x464331, green: 0x354534, cyan: 0x324447, purple: 0x423747 };

function makeBackground(material: 'paper' | 'card'): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas_2d_unavailable');
  context.fillStyle = '#fff';
  if (material === 'paper') { context.shadowBlur = 3; context.shadowOffsetY = 1; context.shadowColor = '#0004'; }
  context.beginPath(); context.roundRect(3, 3, 26, 26, material === 'paper' ? 2 : 6); context.fill();
  if (material === 'card') { context.strokeStyle = '#aaa'; context.lineWidth = 0.5; context.stroke(); }
  return Texture.from(canvas);
}

interface KernelOptions {
  readonly host: HTMLElement;
  readonly width?: number;
  readonly height?: number;
  readonly resolution?: number;
  readonly bitmapBudgetBytes?: number;
  readonly onIntent?: (intent: CanvasKernelIntent) => void;
}

/** Pixi 是唯一引擎依赖点；外部只看到 CanvasKernel 与业务快照。 */
export async function createPixiCanvasKernel(options: KernelOptions): Promise<CanvasKernel> {
  const app = new Application();
  const canvas = document.createElement('canvas');
  const width = options.width ?? options.host.clientWidth;
  const height = options.height ?? options.host.clientHeight;
  await app.init({ canvas, width: Math.max(1, width), height: Math.max(1, height), resolution: options.resolution ?? devicePixelRatio,
    autoDensity: true, autoStart: false, preference: 'webgl', antialias: true, backgroundAlpha: 0 });
  return new PixiCanvasKernel(app, options, width, height);
}

class PixiCanvasKernel implements CanvasKernel {
  readonly canvas: HTMLCanvasElement;
  private readonly world = new Container();
  private readonly lineLayer = new Graphics();
  private readonly cardLayer = new Container();
  private readonly selectionLayer = new Graphics();
  private readonly backgrounds = { paper: makeBackground('paper'), card: makeBackground('card') };
  private readonly views = new Map<CanvasCardId, CardView>();
  private readonly cards = new Map<CanvasCardId, CanvasCard>();
  private readonly bitmaps = new Map<CanvasCardId, BitmapEntry>();
  private readonly selected = new Set<CanvasCardId>();
  private readonly dragOriginals = new Map<CanvasCardId, CanvasCard>();
  private brush: CanvasRectangle | null = null;
  private editingCard: CanvasCardId | null = null;
  private readonly mapLabels = new CanvasMapLabels();
  private overviewOrder: readonly CanvasCard[] = [];
  private edges: readonly CanvasEdge[] = [];
  private ordered: readonly CanvasCard[] = [];
  private camera: CanvasCamera = { x: 0, y: 0, zoom: 1 };
  private appearance: CanvasAppearance = { dark: false, material: 'paper', overview: 'titles' };
  private bitmapBytes = 0;
  private renders = 0;
  private scheduled = 0;
  private destroyed = false;
  private readonly budget: number;
  private readonly removeInteraction: () => void;

  constructor(private readonly app: Application, options: KernelOptions, private width: number, private height: number) {
    this.canvas = app.canvas;
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'application');
    this.canvas.setAttribute('aria-label', '自由画布，按空格拖动平移，使用工具栏编辑所选卡片');
    this.canvas.style.cssText = 'display:block;touch-action:none;width:100%;height:100%';
    options.host.append(this.canvas);
    this.world.addChild(this.lineLayer, this.cardLayer, this.selectionLayer);
    this.app.stage.addChild(this.world, this.mapLabels.sprite);
    this.budget = options.bitmapBudgetBytes ?? 256 * 1024 * 1024;
    this.removeInteraction = options.onIntent ? installCanvasInteraction(this, options.onIntent) : () => undefined;
  }
  private schedule(): void {
    if (this.scheduled || this.destroyed) return;
    this.scheduled = requestAnimationFrame(() => { this.scheduled = 0; if (!this.destroyed) { this.app.render(); this.renders++; } });
  }
  private removeBitmap(id: CanvasCardId): void {
    const entry = this.bitmaps.get(id);
    if (!entry) return;
    const view = this.views.get(id);
    if (view) { for (const child of view.body.removeChildren()) child.destroy(); view.body.visible = false; }
    for (const resource of entry.resources) { resource.texture.destroy(true); resource.bitmap.close(); }
    this.bitmapBytes -= entry.bytes;
    this.bitmaps.delete(id);
    if (view) this.updateView(view);
  }
  private removeView(id: CanvasCardId): void {
    this.removeBitmap(id);
    const view = this.views.get(id);
    if (view) view.container.destroy({ children: true, texture: false });
    this.views.delete(id);
  }
  private visible(card: CanvasCard): boolean {
    return card.x * this.camera.zoom + this.camera.x <= this.width && (card.x + card.width) * this.camera.zoom + this.camera.x >= 0
      && card.y * this.camera.zoom + this.camera.y <= this.height && (card.y + card.height) * this.camera.zoom + this.camera.y >= 0;
  }
  private updateView(view: CardView): void {
    const { card, background, body, label, container } = view;
    container.position.set(card.x, card.y);
    container.visible = this.visible(card);
    background.texture = this.backgrounds[this.appearance.material];
    background.width = card.width;
    background.height = card.height;
    background.tint = (this.appearance.dark ? DARK : LIGHT)[card.color];
    label.resolution = Math.max(0.02, Math.min(2, this.camera.zoom * this.app.renderer.resolution));
    label.text = readCanvasElementText(card).split('\n')[0].slice(0, this.camera.zoom < 0.3 ? 18 : 120) || '空白卡片';
    label.style.fill = this.appearance.dark ? 0xe8e9e3 : 0x252c27;
    label.style.wordWrapWidth = Math.max(1, card.width - 28);
    const overview = card.type !== 'image' && this.camera.zoom < 0.3 && this.appearance.overview === 'titles';
    label.style.fontSize = overview ? Math.min(120, 13 / this.camera.zoom) : 15;
    label.style.wordWrap = !overview;
    label.visible = !overview && !this.bitmaps.has(card.id);
    body.visible = !overview && this.bitmaps.has(card.id);
    if (this.editingCard === card.id) { label.visible = false; body.visible = false; }
    label.position.set(14, 12);
    // 地图标签只在确定的屏幕格中保留一个，避免一屏几千张纹理和文字重叠。
    if (this.camera.zoom < 0.15) { label.visible = false; if (card.type !== 'image') body.visible = false; container.alpha = this.selected.has(card.id) ? 1 : 0.6; }
    else container.alpha = 1;
  }
  private updateLabels(): void {
    this.mapLabels.draw({ cards: this.overviewOrder, camera: this.camera, width: this.width, height: this.height,
      dark: this.appearance.dark, visible: this.camera.zoom < 0.3 && this.appearance.overview === 'titles' });
  }
  private redrawSelection(): void {
    this.selectionLayer.clear();
    if (this.brush) this.selectionLayer.rect(this.brush.x, this.brush.y, this.brush.width, this.brush.height)
      .fill({ color: 0x347b45, alpha: 0.08 }).stroke({ width: 1 / this.camera.zoom, color: 0x347b45, alpha: 0.6 });
    for (const id of this.selected) {
      const card = this.cards.get(id);
      if (card) this.selectionLayer.roundRect(card.x, card.y, card.width, card.height, 4).stroke({ width: 1.5 / this.camera.zoom, color: 0x347b45 });
    }
  }
  private redrawEdges(): void {
    this.lineLayer.clear();
    for (const edge of this.edges) {
      const points = canvasEdgePoints(edge, this.cards, this.camera.zoom);
      const first = points[0];
      if (!first) continue;
      this.lineLayer.moveTo(first.x, first.y);
      for (let i = 1; i < points.length; i++) this.lineLayer.lineTo(points[i].x, points[i].y);
      this.lineLayer.stroke({ width: 1 / this.camera.zoom, color: this.appearance.dark ? 0xc7cec6 : 0x28352a, alpha: 0.28 });
      if (edge.direction !== 'none' && points.length >= 2) {
        this.drawArrow(points[points.length - 1], points[points.length - 2]);
        if (edge.direction === 'both') this.drawArrow(points[0], points[1]);
      }
    }
  }
  private drawArrow(tip: CanvasPoint, previous: CanvasPoint): void {
    const angle = Math.atan2(tip.y - previous.y, tip.x - previous.x);
    const size = 6 / this.camera.zoom;
    this.lineLayer.moveTo(tip.x - Math.cos(angle - 0.45) * size, tip.y - Math.sin(angle - 0.45) * size)
      .lineTo(tip.x, tip.y).lineTo(tip.x - Math.cos(angle + 0.45) * size, tip.y - Math.sin(angle + 0.45) * size)
      .stroke({ width: 1 / this.camera.zoom, color: this.appearance.dark ? 0xc7cec6 : 0x28352a, alpha: 0.5 });
  }
  private refreshCamera(styleChanged = false, edgesChanged = false): void {
    this.world.position.set(this.camera.x, this.camera.y);
    this.world.scale.set(this.camera.zoom);
    for (const view of this.views.values()) {
      if (styleChanged) this.updateView(view);
      else view.container.visible = this.visible(view.card);
      if (view.container.visible && this.camera.zoom >= 0.3) {
        const entry = this.bitmaps.get(view.card.id);
        if (entry) { this.bitmaps.delete(view.card.id); this.bitmaps.set(view.card.id, entry); }
      }
    }
    this.updateLabels();
    if (styleChanged) this.redrawSelection();
    if (edgesChanged) this.redrawEdges();
    this.schedule();
  }

  setElements(elements: readonly CanvasElement[]): void {
    this.dragOriginals.clear();
    const nextCards = elements.filter((element): element is CanvasCard => element.type !== 'edge');
    const nextIds = new Set(nextCards.map((card) => card.id));
    for (const id of this.views.keys()) if (!nextIds.has(id)) this.removeView(id);
    this.cards.clear();
    for (const card of nextCards) {
      this.cards.set(card.id, card);
      const previous = this.views.get(card.id);
      // 纯位置/颜色变化不重画正文；尺寸或内容变了才淘汰位图。
      if (previous && previous.card.revision !== card.revision
        && (previous.card.width !== card.width || previous.card.height !== card.height
          || previous.card.type !== card.type || JSON.stringify(previous.card.data) !== JSON.stringify(card.data))) {
        this.removeBitmap(card.id);
      }
      if (previous) {
        const view = { ...previous, card };
        view.label.text = readCanvasElementText(card).split('\n')[0].slice(0, 120) || (card.type === 'image' ? '图片' : '空白卡片');
        this.views.set(card.id, view);
      } else this.createView(card);
    }
    this.ordered = nextCards.sort((a, b) => a.order < b.order ? -1 : a.order > b.order ? 1 : 0);
    this.overviewOrder = nextCards.slice().sort((a, b) => Number(b.color !== 'white') - Number(a.color !== 'white')
      || Number(b.type === 'document') - Number(a.type === 'document') || b.width * b.height - a.width * a.height);
    for (let i = 0; i < this.ordered.length; i++) {
      const view = this.views.get(this.ordered[i].id);
      if (view) this.cardLayer.setChildIndex(view.container, i);
    }
    this.edges = elements.filter((element): element is CanvasEdge => element.type === 'edge');
    this.refreshCamera(true, true);
  }

  private createView(card: CanvasCard): void {
    const container = new Container();
    const background = new NineSliceSprite({ texture: this.backgrounds[this.appearance.material], leftWidth: 8, rightWidth: 8, topHeight: 8, bottomHeight: 8 });
    const body = new Container();
    body.visible = false;
    const label = new Text({ text: readCanvasElementText(card).split('\n')[0].slice(0, 120) || '空白卡片',
      style: { fontFamily: 'system-ui', fontSize: 15, wordWrap: true, wordWrapWidth: Math.max(1, card.width - 28), breakWords: true } });
    container.addChild(background, body, label);
    this.cardLayer.addChild(container);
    this.views.set(card.id, { card, container, background, body, label });
  }

  setCamera(next: CanvasCamera): void {
    const zoom = Math.max(0.02, Math.min(4, next.zoom));
    const zoomChanged = zoom !== this.camera.zoom;
    this.camera = { x: next.x, y: next.y, zoom };
    this.refreshCamera(zoomChanged, zoomChanged);
  }
  readCamera(): CanvasCamera { return { ...this.camera }; }
  setSelection(ids: readonly CanvasCardId[]): void {
    this.selected.clear(); ids.forEach((id) => this.selected.add(id));
    this.redrawSelection(); this.schedule();
  }
  readSelection(): readonly CanvasCardId[] { return [...this.selected]; }
  hasBitmap(id: CanvasCardId, key: string): boolean { return this.bitmaps.get(id)?.key === key; }
  setEditingCard(id: CanvasCardId | null): void {
    const previous = this.editingCard; this.editingCard = id;
    for (const target of [previous, id]) { if (target) { const view = this.views.get(target); if (view) this.updateView(view); } }
    this.schedule();
  }
  setBrush(rectangle: CanvasRectangle | null): void { this.brush = rectangle; this.redrawSelection(); this.schedule(); }
  setDragPreview(ids: readonly CanvasCardId[], dx: number, dy: number): void {
    for (const id of ids) {
      let view = this.views.get(id);
      if (!view || view.card.locked) continue;
      if (!this.dragOriginals.has(id)) {
        this.dragOriginals.set(id, view.card);
        // 只在手势开始时复制绘制投影，后续 pointermove 不逐卡分配对象。
        const display = { ...view.card };
        view = { ...view, card: display };
        this.cards.set(id, display); this.views.set(id, view);
      }
      const original = this.dragOriginals.get(id);
      if (!original) continue;
      view.card.x = original.x + dx; view.card.y = original.y + dy;
      view.container.position.set(view.card.x, view.card.y);
    }
    this.redrawEdges(); this.redrawSelection(); this.schedule();
  }
  clearDragPreview(): void {
    for (const [id, card] of this.dragOriginals) {
      const view = this.views.get(id);
      this.cards.set(id, card);
      if (view) { this.views.set(id, { ...view, card }); view.container.position.set(card.x, card.y); }
    }
    this.dragOriginals.clear(); this.redrawEdges(); this.redrawSelection(); this.schedule();
  }
  setBitmap(id: CanvasCardId, revision: number, key: string, bitmap: ImageBitmap): boolean {
    const card = this.cards.get(id);
    if (!card) { bitmap.close(); return false; }
    return this.setRasterTiles(id, revision, key, [{ bitmap, x: 0, y: 0, width: card.width, height: card.height }]);
  }
  setRasterTiles(id: CanvasCardId, revision: number, key: string, tiles: readonly CanvasRasterTile[]): boolean {
    const card = this.cards.get(id);
    if (!card || card.revision !== revision || this.destroyed) { tiles.forEach((tile) => tile.bitmap.close()); return false; }
    const previous = this.bitmaps.get(id);
    if (previous?.key === key) { tiles.forEach((tile) => tile.bitmap.close()); return true; }
    const bytes = tiles.reduce((total, tile) => total + tile.bitmap.width * tile.bitmap.height * 4, 0);
    if (bytes > this.budget) { tiles.forEach((tile) => tile.bitmap.close()); return false; }
    this.removeBitmap(id);
    while (this.bitmapBytes + bytes > this.budget) {
      const oldest = this.bitmaps.keys().next();
      if (oldest.done) break;
      this.removeBitmap(oldest.value);
    }
    const resources = tiles.map((tile) => ({ texture: Texture.from(tile.bitmap, true), bitmap: tile.bitmap }));
    this.bitmaps.set(id, { key, resources, bytes }); this.bitmapBytes += bytes;
    const view = this.views.get(id);
    if (view) {
      tiles.forEach((tile, index) => {
        const sprite = new Sprite(resources[index].texture);
        sprite.position.set(tile.x, tile.y); sprite.width = tile.width; sprite.height = tile.height;
        view.body.addChild(sprite);
      });
      this.updateView(view);
    }
    this.schedule(); return true;
  }
  invalidateBitmaps(): void { for (const id of this.bitmaps.keys()) this.removeBitmap(id); this.schedule(); }
  setAppearance(next: CanvasAppearance): void {
    if (next.dark !== this.appearance.dark) this.invalidateBitmaps();
    this.appearance = next; this.refreshCamera(true, true);
  }
  resize(width: number, height: number, resolution?: number): void {
    this.width = width; this.height = height;
    this.app.renderer.resize(Math.max(1, width), Math.max(1, height), resolution);
    this.refreshCamera();
  }
  fit(rectangles: readonly CanvasRectangle[]): void {
    const bounds = canvasBounds(rectangles);
    if (!bounds) return;
    const zoom = Math.max(0.02, Math.min(1, (this.width - 80) / Math.max(1, bounds.width), (this.height - 80) / Math.max(1, bounds.height)));
    this.setCamera({ zoom, x: (this.width - bounds.width * zoom) / 2 - bounds.x * zoom, y: (this.height - bounds.height * zoom) / 2 - bounds.y * zoom });
  }
  hitTest(point: CanvasPoint): CanvasCard | null {
    for (let i = this.ordered.length - 1; i >= 0; i--) {
      const card = this.cards.get(this.ordered[i].id);
      if (!card) continue;
      if (point.x >= card.x && point.x <= card.x + card.width && point.y >= card.y && point.y <= card.y + card.height) return card;
    }
    return null;
  }
  visibleCards(): readonly CanvasCard[] { return this.ordered.filter((card) => this.visible(card)); }
  screenToWorld(point: CanvasPoint): CanvasPoint { return canvasScreenToWorld(point, this.camera); }
  worldToScreen(point: CanvasPoint): CanvasPoint { return canvasWorldToScreen(point, this.camera); }
  async captureImage(format: 'png' | 'jpeg', quality = 0.9): Promise<string> {
    return this.app.renderer.extract.base64({ target: this.app.stage, format: format === 'jpeg' ? 'jpg' : 'png',
      quality, frame: new Rectangle(0, 0, this.width, this.height), resolution: this.app.renderer.resolution,
      clearColor: this.appearance.dark ? '#222723' : '#f2f3ee' });
  }
  readStats() { return { cards: this.cards.size, edges: this.edges.length, bitmaps: this.bitmaps.size, bitmapBytes: this.bitmapBytes, renders: this.renders }; }
  destroy(): void {
    this.destroyed = true;
    if (this.scheduled) cancelAnimationFrame(this.scheduled);
    this.removeInteraction();
    this.invalidateBitmaps();
    this.mapLabels.destroy();
    this.app.destroy({ removeView: true }, { children: true, texture: false });
    this.backgrounds.paper.destroy(true); this.backgrounds.card.destroy(true);
    this.views.clear(); this.cards.clear();
  }
}
