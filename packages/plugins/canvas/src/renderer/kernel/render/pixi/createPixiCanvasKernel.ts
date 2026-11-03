// Pixi 的静态 uniform polyfill 支持严格 CSP；不放开 script-src unsafe-eval。
import 'pixi.js/unsafe-eval';
import { Application, Container, Graphics, NineSliceSprite, Rectangle, Text, Texture } from 'pixi.js';
import {
  canvasBounds, canvasScreenToWorld, canvasWorldToScreen, readCanvasElementText, readCanvasCardPalette,
  type CanvasCamera, type CanvasCard, type CanvasCardId,
  type CanvasEdge, type CanvasEdgeId, type CanvasElement, type CanvasPoint, type CanvasRectangle,
} from '../../../../shared';
import type { CanvasAppearance, CanvasGuide, CanvasKernel, CanvasKernelIntent, CanvasRasterTile, CanvasRenderStatus } from '../../definitions/canvasKernel';
import { installCanvasInteraction } from '../../interaction/installCanvasInteraction';
import { CanvasMapLabels } from './CanvasMapLabels';
import { CanvasLines } from './CanvasLines';
import { intersectCanvasRegion } from '../../geometry/canvasVisibleRegions';
import { CanvasSpatialProjection } from '../../geometry/CanvasSpatialProjection';
import { readCanvasGpuMode } from './readCanvasGpuMode';
import { CanvasBitmapCache } from './CanvasBitmapCache';

interface CardView { readonly card: CanvasCard; readonly container: Container; readonly background: NineSliceSprite; readonly body: Container; readonly label: Text; visibleAfterRender: number }

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
  readonly readonly?: boolean;
  readonly readReadonly?: () => boolean;
  readonly readInteractionPreferences?: () => { readonly wheelZoom: boolean; readonly snapping: boolean };
  readonly renderingMode?: 'interactive' | 'capture';
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
  private readonly world = new Container({ isRenderGroup: true });
  private readonly lines = new CanvasLines();
  private readonly cardLayer = new Container();
  private readonly selectionLayer = new Graphics();
  private readonly guideLayer = new Graphics();
  private guides: readonly CanvasGuide[] = [];
  private readonly backgrounds = { paper: makeBackground('paper'), card: makeBackground('card') };
  private readonly views = new Map<CanvasCardId, CardView>();
  private readonly cards = new Map<CanvasCardId, CanvasCard>();
  private readonly bitmaps: CanvasBitmapCache;
  private readonly selected = new Set<CanvasCardId>();
  private readonly dragOriginals = new Map<CanvasCardId, CanvasCard>();
  private brush: CanvasRectangle | null = null;
  private editingCard: CanvasCardId | null = null;
  private documentTitles: ReadonlyMap<string, string> = new Map();
  private thumbnailCards: ReadonlySet<CanvasCardId> = new Set();
  private readonly textTitles = new WeakMap<CanvasCard, string>();
  private readonly mapLabels = new CanvasMapLabels();
  private overviewOrder: readonly CanvasCard[] = [];
  private titleOrder: readonly CanvasCard[] = [];
  private edges: readonly CanvasEdge[] = [];
  private ordered: readonly CanvasCard[] = [];
  private exposed: readonly CanvasCard[] = [];
  private exposedIds = new Set<CanvasCardId>();
  private visibleRegions: ReadonlyMap<CanvasCardId, readonly CanvasRectangle[]> = new Map();
  private readonly spatial = new CanvasSpatialProjection();
  private camera: CanvasCamera = { x: 0, y: 0, zoom: 1 };
  private appearance: CanvasAppearance = { dark: false, material: 'paper', overview: 'titles' };
  private renders = 0;
  private scheduled = 0;
  private destroyed = false;
  private readonly removeInteraction: () => void;
  private readonly reduced: boolean;
  private readonly capture: boolean;
  private readonly software: boolean;
  private readonly notify?: (intent: CanvasKernelIntent) => void;
  private renderStatus: CanvasRenderStatus = { limited: false, phase: 'ready', message: null };
  private contextLost = false;
  private contextGeneration = 0;
  private readonly loseContext = (event: Event) => {
    event.preventDefault(); this.contextLost = true; this.contextGeneration++;
    this.renderStatus = { limited: true, phase: 'restoring', message: '图形渲染正在恢复，内容已保留' };
    this.notify?.({ kind: 'render-status', ...this.renderStatus });
  };
  private readonly restoreContext = () => {
    this.contextLost = false;
    this.renderStatus = { limited: this.software, phase: 'ready', message: this.software ? '当前使用软件绘图，性能受限' : null };
    this.refreshCamera(true); this.notify?.({ kind: 'render-status', ...this.renderStatus });
  };
  /** @canvasFrame 纯绘制闭包；内容排版和相机投影在明确的输入/异步批次阶段完成。 */
  private readonly renderFrame = () => {
    this.scheduled = 0;
    if (!this.destroyed && !this.contextLost) { this.app.render(); this.renders++; }
  };

  constructor(private readonly app: Application, options: KernelOptions, private width: number, private height: number) {
    this.canvas = app.canvas;
    // 命中由空间索引和原生DOM事件负责，Pixi只绘制，避免第二套隐式全树扫描。
    app.stage.eventMode = 'none';
    this.capture = options.renderingMode === 'capture';
    this.software = readCanvasGpuMode(app.renderer).software;
    this.reduced = this.software && options.renderingMode !== 'capture'; this.notify = options.onIntent;
    if (this.reduced) app.renderer.resize(Math.max(1, width), Math.max(1, height), 1);
    this.lines.setReduced(this.reduced);
    this.renderStatus = { limited: this.software, phase: 'ready', message: this.software ? '当前使用软件绘图，性能受限' : null };
    this.canvas.addEventListener('webglcontextlost', this.loseContext); this.canvas.addEventListener('webglcontextrestored', this.restoreContext);
    queueMicrotask(() => { if (!this.destroyed) this.notify?.({ kind: 'render-status', ...this.renderStatus }); });
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'application');
    this.canvas.setAttribute('aria-label', '自由画布，按空格拖动平移，使用工具栏编辑所选卡片');
    this.canvas.style.cssText = 'display:block;touch-action:none;width:100%;height:100%';
    options.host.append(this.canvas);
    this.world.addChild(this.cardLayer, this.guideLayer, this.selectionLayer);
    this.app.stage.addChild(this.lines.below, this.world, this.lines.above, this.mapLabels.sprite);
    this.bitmaps = new CanvasBitmapCache({ budget: options.bitmapBudgetBytes ?? 256 * 1024 * 1024, readRenderCount: () => this.renders, changed: id => {
      const view = this.views.get(id); if (!this.destroyed && view) { this.updateView(view); this.schedule(); }
    } });
    this.removeInteraction = options.onIntent ? installCanvasInteraction(this, options.onIntent, { readonly: options.readonly, readReadonly: options.readReadonly, readPreferences: options.readInteractionPreferences }) : () => undefined;
  }
  private schedule(): void {
    if (this.scheduled || this.destroyed || this.contextLost) return;
    this.scheduled = requestAnimationFrame(this.renderFrame);
  }
  private removeBitmap(id: CanvasCardId): void {
    this.bitmaps.remove(id);
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
    const wasVisible = container.visible && body.visible;
    container.position.set(card.x, card.y);
    container.visible = this.exposedIds.has(card.id);
    background.texture = this.backgrounds[this.appearance.material];
    background.width = card.width;
    background.height = card.height;
    const palette = readCanvasCardPalette(card.color, this.appearance.dark);
    background.tint = palette.paper;
    // 近景身份牌必须复用纹理；连续缩放不能每个事件重新生成几百张文字纹理。
    label.resolution = Math.max(1, this.app.renderer.resolution);
    label.style.fill = palette.title;
    label.style.wordWrapWidth = Math.max(1, card.width - 28);
    const overview = !this.keepsThumbnail(card) && this.camera.zoom < 0.3 && this.appearance.overview === 'titles';
    label.style.fontSize = 15;
    label.style.wordWrap = true;
    label.visible = !overview && this.titleExposed(card) && !this.bitmaps.covers(card.id, this.readVisibleCardRegions(card.id));
    body.visible = !overview && this.bitmaps.has(card.id);
    if (this.editingCard === card.id) { label.visible = false; body.visible = false; }
    if (!wasVisible && container.visible && body.visible) view.visibleAfterRender = this.renders;
    label.position.set(14, 12);
    // 地图标签只在确定的屏幕格中保留一个，避免一屏几千张纹理和文字重叠。
    if (this.camera.zoom < 0.15) { label.visible = false; container.alpha = this.selected.has(card.id) ? 1 : 0.6; }
    else container.alpha = 1;
  }
  private titleExposed(card: CanvasCard): boolean {
    const region = { x: 14, y: 12, width: Math.max(0, card.width - 28), height: Math.max(0, card.height - 12) };
    return this.readVisibleCardRegions(card.id).some(visible => intersectCanvasRegion(region, visible) !== null);
  }
  private updateLabels(): void {
    this.mapLabels.draw({ cards: this.titleOrder, camera: this.camera, width: this.width, height: this.height,
      dark: this.appearance.dark, visible: this.camera.zoom < 0.3 && this.appearance.overview === 'titles', readTitle: card => this.title(card) });
  }
  private title(card: CanvasCard): string {
    if (card.type === 'document') return this.documentTitles.get(card.data.documentId) ?? '文档';
    const cached = this.textTitles.get(card);
    if (cached !== undefined) return cached;
    const value = readCanvasElementText(card); this.textTitles.set(card, value); return value;
  }
  private redrawGuides(): void {
    this.guideLayer.clear();
    for (const guide of this.guides) this.guideLayer.moveTo(guide.from.x, guide.from.y).lineTo(guide.to.x, guide.to.y);
    this.guideLayer.stroke({ width: 1 / this.camera.zoom, color: 0x347b45, alpha: 0.75 });
  }
  setGuides(guides: readonly CanvasGuide[]): void { this.guides = guides; this.redrawGuides(); this.schedule(); }
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
    this.lines.setElements(this.edges, this.cards, [...this.visibleRegions.values()].flat());
  }
  private refreshCamera(styleChanged = false, edgesChanged = false): void {
    this.world.position.set(this.camera.x, this.camera.y);
    this.world.scale.set(this.camera.zoom);
    this.projectCards(styleChanged);
    this.updateLabels();
    if (styleChanged) this.redrawSelection();
    if (edgesChanged) this.redrawEdges();
    this.lines.setCamera(this.camera, this.width, this.height, this.app.renderer.resolution);
    this.schedule();
  }

  private projectCards(styleChanged: boolean): void {
    const projection = this.spatial.project({ x: -this.camera.x / this.camera.zoom, y: -this.camera.y / this.camera.zoom,
      width: this.width / this.camera.zoom, height: this.height / this.camera.zoom });
    if (projection !== this.visibleRegions) { this.visibleRegions = projection; this.lines.setMask([...projection.values()].flat()); }
    this.exposed = this.ordered.flatMap(entry => { const card = this.cards.get(entry.id); return card && this.readVisibleCardRegions(card.id).length ? [card] : []; });
    this.exposedIds = new Set(this.exposed.map(card => card.id));
    for (const view of this.views.values()) {
      if (styleChanged) this.updateView(view);
      else {
        const wasVisible = view.container.visible;
        view.container.visible = this.exposedIds.has(view.card.id);
        if (!wasVisible && view.container.visible) view.visibleAfterRender = this.renders;
        if (view.container.visible) {
          const overview = !this.keepsThumbnail(view.card) && this.camera.zoom < 0.3 && this.appearance.overview === 'titles';
          view.label.visible = this.editingCard !== view.card.id && !overview && this.titleExposed(view.card) && !this.bitmaps.covers(view.card.id, this.readVisibleCardRegions(view.card.id));
        }
      }
      if (view.container.visible && this.camera.zoom >= 0.3) {
        this.bitmaps.touch(view.card.id);
      }
    }
  }

  setElements(elements: readonly CanvasElement[]): void {
    this.dragOriginals.clear();
    const nextCards = elements.filter((element): element is CanvasCard => element.type !== 'edge');
    const nextIds = new Set(nextCards.map((card) => card.id));
    for (const id of this.views.keys()) if (!nextIds.has(id)) this.removeView(id);
    this.cards.clear();
    for (const card of nextCards) this.installCard(card);
    this.ordered = nextCards.sort((a, b) => a.order < b.order ? -1 : a.order > b.order ? 1 : 0);
    this.spatial.setCards(this.ordered);
    this.overviewOrder = nextCards.slice().sort((a, b) => Number(b.color !== 'white') - Number(a.color !== 'white')
      || Number(b.type === 'document') - Number(a.type === 'document') || b.width * b.height - a.width * a.height);
    this.refreshTitleOrder();
    for (let i = 0; i < this.ordered.length; i++) {
      const view = this.views.get(this.ordered[i].id);
      if (view) this.cardLayer.setChildIndex(view.container, i);
    }
    this.edges = elements.filter((element): element is CanvasEdge => element.type === 'edge');
    this.refreshCamera(true, true);
  }

  private installCard(card: CanvasCard): void {
    this.cards.set(card.id, card);
    const previous = this.views.get(card.id);
    // 纯位置变化不重画正文；染纸会改变同色深墨，必须和尺寸/内容变化一起淘汰。
    if (previous && previous.card.revision !== card.revision
      && (previous.card.width !== card.width || previous.card.height !== card.height || previous.card.color !== card.color
        || previous.card.type !== card.type || JSON.stringify(previous.card.data) !== JSON.stringify(card.data))) {
      this.removeBitmap(card.id);
    }
    if (previous) {
      const view = { ...previous, card };
      view.label.text = this.title(card).split('\n')[0].slice(0, 120) || (card.type === 'image' ? '图片' : '空白卡片');
      this.views.set(card.id, view);
    } else this.createView(card);
  }

  private createView(card: CanvasCard): void {
    const container = new Container();
    const background = new NineSliceSprite({ texture: this.backgrounds[this.appearance.material], leftWidth: 8, rightWidth: 8, topHeight: 8, bottomHeight: 8 });
    const body = new Container();
    body.visible = false;
    const label = new Text({ text: this.title(card).split('\n')[0].slice(0, 120) || '空白卡片',
      style: { fontFamily: 'system-ui', fontSize: 15, wordWrap: true, wordWrapWidth: Math.max(1, card.width - 28), breakWords: true } });
    container.addChild(background, body, label);
    this.cardLayer.addChild(container);
    this.views.set(card.id, { card, container, background, body, label, visibleAfterRender: this.renders });
  }

  setCamera(next: CanvasCamera): void {
    // 导出区域由输出像素/世界尺寸确定倍率；交互缩放上限不能改变所请求的裁切。
    const zoom = this.capture ? next.zoom : Math.max(0.02, Math.min(4, next.zoom));
    const zoomChanged = zoom !== this.camera.zoom;
    const lodChanged = (zoom < 0.15) !== (this.camera.zoom < 0.15) || (zoom < 0.3) !== (this.camera.zoom < 0.3);
    this.camera = { x: next.x, y: next.y, zoom };
    // 大多数缩放帧只改相机；卡片外观只在明确的LOD边界变化。
    this.refreshCamera(lodChanged);
    if (zoomChanged) { this.redrawSelection(); this.redrawGuides(); }
  }
  readCamera(): CanvasCamera { return { ...this.camera }; }
  readRenderStatus(): CanvasRenderStatus { return { ...this.renderStatus }; }
  readResolution(): number { return this.app.renderer.resolution; }
  setSelection(ids: readonly CanvasCardId[]): void {
    if (ids.length === this.selected.size && ids.every(id => this.selected.has(id))) return;
    const previous = [...this.selected];
    this.selected.clear(); ids.forEach((id) => this.selected.add(id));
    for (const id of [...previous, ...ids]) { const view = this.views.get(id); if (view) view.container.alpha = this.camera.zoom < 0.15 && !this.selected.has(id) ? 0.6 : 1; }
    this.refreshTitleOrder(); this.updateLabels();
    this.lines.setSelection(ids);
    this.redrawSelection(); this.schedule();
  }
  readSelection(): readonly CanvasCardId[] { return [...this.selected]; }
  hasBitmap(id: CanvasCardId, key: string): boolean { return this.bitmaps.has(id, key); }
  readRasterReceipt(id: CanvasCardId, key: string): { readonly acceptedAfterRender: number; readonly rendered: boolean } | null {
    const accepted = this.bitmaps.readReceipt(id, key), view = this.views.get(id);
    if (accepted === null || !view) return null;
    const acceptedAfterRender = Math.max(accepted, view.visibleAfterRender);
    return { acceptedAfterRender, rendered: !this.contextLost && view.container.visible && view.body.visible && this.renders > acceptedAfterRender };
  }
  setEditingCard(id: CanvasCardId | null): void {
    const previous = this.editingCard; this.editingCard = id;
    for (const target of [previous, id]) { if (target) { const view = this.views.get(target); if (view) this.updateView(view); } }
    this.schedule();
  }
  setBrush(rectangle: CanvasRectangle | null): void { this.brush = rectangle; this.redrawSelection(); this.schedule(); }
  setDragPreview(ids: readonly CanvasCardId[], dx: number, dy: number): void {
    const starting = this.dragOriginals.size === 0;
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
    if (starting) this.refreshOverviewCards();
    this.mapLabels.invalidate(); if (this.camera.zoom < 0.3) this.updateLabels();
    const movingIds = [...this.dragOriginals.keys()];
    this.spatial.updateCards(movingIds.flatMap(id => { const card = this.cards.get(id); return card ? [card] : []; }));
    this.projectCards(false);
    this.lines.preview(movingIds, this.cards, [...this.visibleRegions.values()].flat()); this.redrawSelection(); this.schedule();
    this.notify?.({ kind: 'preview-changed' });
  }
  clearDragPreview(): void {
    for (const [id, card] of this.dragOriginals) {
      const view = this.views.get(id);
      this.cards.set(id, card);
      if (view) { this.views.set(id, { ...view, card }); view.container.position.set(card.x, card.y); }
    }
    this.spatial.updateCards([...this.dragOriginals.values()]);
    this.dragOriginals.clear(); this.refreshOverviewCards(); this.mapLabels.invalidate(); this.updateLabels(); this.projectCards(false); this.redrawEdges(); this.redrawSelection(); this.schedule();
    this.notify?.({ kind: 'preview-changed' });
  }
  private refreshTitleOrder(): void {
    const selected: CanvasCard[] = [], remaining: CanvasCard[] = [];
    for (const card of this.overviewOrder) {
      if (this.keepsThumbnail(card)) continue;
      (this.selected.has(card.id) ? selected : remaining).push(card);
    }
    // 只作稳定分区，保留颜色/文档/面积原优先序；选择不需要重新排序整张画布。
    this.titleOrder = [...selected, ...remaining];
  }
  private refreshOverviewCards(): void {
    this.overviewOrder = this.overviewOrder.map(card => this.cards.get(card.id) ?? card);
    this.refreshTitleOrder();
  }
  setBitmap(id: CanvasCardId, revision: number, key: string, bitmap: ImageBitmap): boolean {
    const card = this.cards.get(id);
    if (!card) { bitmap.close(); return false; }
    return this.setRasterTiles(id, revision, key, [{ bitmap, scale: bitmap.width / card.width, x: 0, y: 0, width: card.width, height: card.height }]);
  }
  setRasterTiles(id: CanvasCardId, revision: number, key: string, tiles: readonly CanvasRasterTile[]): boolean {
    const card = this.cards.get(id);
    const view = this.views.get(id);
    if (!card || !view || card.revision !== revision || this.destroyed) { tiles.forEach(tile => tile.bitmap.close()); return false; }
    return this.bitmaps.install(id, key, tiles, view.body);
  }
  invalidateBitmaps(): void { this.bitmaps.clear(); this.schedule(); }
  setAppearance(next: CanvasAppearance): void {
    if (next.dark !== this.appearance.dark) this.invalidateBitmaps();
    this.appearance = next; this.lines.setAppearance(next); this.refreshCamera(true);
  }
  resize(width: number, height: number, resolution?: number): void {
    this.width = width; this.height = height;
    this.app.renderer.resize(Math.max(1, width), Math.max(1, height), this.reduced ? Math.min(1, resolution ?? this.app.renderer.resolution) : resolution);
    this.refreshCamera(true);
  }
  fit(rectangles: readonly CanvasRectangle[]): void {
    const bounds = canvasBounds(rectangles);
    if (!bounds) return;
    const zoom = Math.max(0.02, Math.min(1, (this.width - 80) / Math.max(1, bounds.width), (this.height - 80) / Math.max(1, bounds.height)));
    this.setCamera({ zoom, x: (this.width - bounds.width * zoom) / 2 - bounds.x * zoom, y: (this.height - bounds.height * zoom) / 2 - bounds.y * zoom });
  }
  hitTest(point: CanvasPoint): CanvasCard | null {
    return this.spatial.hitTest(point);
  }
  readCard(id: CanvasCardId): CanvasCard | null { return this.cards.get(id) ?? null; }
  visibleCards(): readonly CanvasCard[] { return this.ordered.flatMap(entry => { const card = this.cards.get(entry.id); return card && this.visible(card) ? [card] : []; }); }
  renderableCards(): readonly CanvasCard[] { return this.exposed; }
  private keepsThumbnail(card: CanvasCard): boolean { return card.type === 'image' || this.thumbnailCards.has(card.id); }
  rasterCards(): readonly CanvasCard[] { return this.appearance.overview === 'thumbnails' || this.camera.zoom >= 0.3 ? this.exposed : this.exposed.filter(card => this.keepsThumbnail(card)); }
  readVisibleCardRegions(id: CanvasCardId): readonly CanvasRectangle[] {
    const card = this.cards.get(id);
    if (!card) return [];
    const regions = this.visibleRegions.get(id) ?? [];
    const viewport = { x: -this.camera.x / this.camera.zoom, y: -this.camera.y / this.camera.zoom,
      width: this.width / this.camera.zoom, height: this.height / this.camera.zoom };
    return regions.flatMap(region => {
      const visible = intersectCanvasRegion(region, viewport);
      return visible ? [{ x: visible.x - card.x, y: visible.y - card.y, width: visible.width, height: visible.height }] : [];
    });
  }
  readMissingBitmapRegions(id: CanvasCardId, key: string, regions: readonly CanvasRectangle[], resolution: { readonly scale: number; readonly exact: boolean }): readonly CanvasRectangle[] {
    return this.bitmaps.missing(id, key, regions, resolution);
  }
  hitTestEdge(point: CanvasPoint): CanvasEdge | null { return this.lines.hitTest(point); }
  setSelectedEdge(id: CanvasEdgeId | null): void { this.lines.setSelected(id); this.schedule(); }
  setHoveredCard(id: CanvasCardId | null): void { this.lines.setHovered(id); this.schedule(); }
  setDocumentTitles(titles: ReadonlyMap<string, string>): void {
    this.documentTitles = new Map(titles);
    this.mapLabels.invalidate();
    for (const view of this.views.values()) if (view.card.type === 'document') view.label.text = this.title(view.card).split('\n')[0].slice(0, 120);
    this.updateLabels(); this.schedule();
  }
  setThumbnailCards(ids: ReadonlySet<CanvasCardId>): void {
    if (ids.size === this.thumbnailCards.size && [...ids].every(id => this.thumbnailCards.has(id))) return;
    this.thumbnailCards = new Set(ids);
    this.refreshTitleOrder();
    this.refreshCamera(true);
  }
  readEdgeGeometry(id: CanvasEdgeId) { return this.lines.readGeometry(id); }
  screenToWorld(point: CanvasPoint): CanvasPoint { return canvasScreenToWorld(point, this.camera); }
  worldToScreen(point: CanvasPoint): CanvasPoint { return canvasWorldToScreen(point, this.camera); }
  async captureImage(format: 'png' | 'jpeg', quality = 0.9): Promise<string> {
    if (this.contextLost) throw new Error('canvas_graphics_context_lost');
    const generation = this.contextGeneration;
    const result = await this.app.renderer.extract.base64({ target: this.app.stage, format: format === 'jpeg' ? 'jpg' : 'png',
      quality, frame: new Rectangle(0, 0, this.width, this.height), resolution: this.app.renderer.resolution,
      clearColor: this.appearance.dark ? '#222723' : '#f2f3ee' });
    if (this.contextLost || generation !== this.contextGeneration) throw new Error('canvas_graphics_context_lost');
    return result;
  }
  readStats() { return { viewportCards: this.visibleCards().length, renderableCards: this.exposed.length, rasterCards: this.rasterCards().length, cards: this.cards.size, edges: this.edges.length, renders: this.renders, ...this.bitmaps.readStats(), ...this.lines.readStats(), ...this.spatial.readStats() }; }
  destroy(): void {
    this.destroyed = true;
    if (this.scheduled) cancelAnimationFrame(this.scheduled);
    this.removeInteraction();
    this.canvas.removeEventListener('webglcontextlost', this.loseContext); this.canvas.removeEventListener('webglcontextrestored', this.restoreContext);
    this.canvas.remove();
    this.invalidateBitmaps(); this.mapLabels.destroy(); this.lines.destroy();
    this.views.clear(); this.cards.clear();
    // HTML paint事件兑现的Promise仍在Chromium原生paint回调的微任务中。
    // 此时WEBGL_lose_context会使Renderer进程崩溃；下一task完整释放GPU，逻辑关闭立即生效。
    setTimeout(() => {
      this.app.destroy({ removeView: true }, { children: true, texture: false });
      this.backgrounds.paper.destroy(true); this.backgrounds.card.destroy(true);
    }, 0);
  }
}
