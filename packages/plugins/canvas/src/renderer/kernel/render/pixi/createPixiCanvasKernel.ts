// Pixi 的静态 uniform polyfill 支持严格 CSP；不放开 script-src unsafe-eval。
import 'pixi.js/unsafe-eval';
import { Application, Container, Graphics, NineSliceSprite, Rectangle, Texture, type Sprite } from 'pixi.js';
import {
  canvasScreenToWorld, canvasWorldToScreen, readCanvasElementText, readCanvasCardPalette,
  type CanvasCamera, type CanvasCard, type CanvasCardId,
  type CanvasEdge, type CanvasEdgeId, type CanvasElement, type CanvasPoint, type CanvasRectangle,
} from '../../../../shared';
import type { CanvasAppearance, CanvasGuide, CanvasKernel, CanvasKernelIntent, CanvasRasterTile, CanvasRenderStatus, CanvasSceneMotionOptions } from '../../definitions/canvasKernel';
import { installCanvasInteraction } from '../../interaction/installCanvasInteraction';
import { CanvasMapLabels } from './CanvasMapLabels';
import { CanvasLines } from './CanvasLines';
import { intersectCanvasRegion } from '../../geometry/canvasVisibleRegions';
import { CanvasSpatialProjection } from '../../geometry/CanvasSpatialProjection';
import { readCanvasGpuMode } from './readCanvasGpuMode';
import type { CanvasBitmapCache } from './CanvasBitmapCache';
import { CanvasSceneMotion, type CanvasMotionView } from './CanvasSceneMotion';
import { planCanvasSceneMotion, resolveCanvasDisplayCard, canvasCardRasterChanged, type CanvasSceneMotionPlan } from '../../motion';
import { canvasFitText } from '../../geometry/canvasFitText';
import { canvasTitlePrefix } from '../../geometry/canvasTextGraphemes';
import { canvasFitCamera } from '../../geometry/canvasFitCamera';
import { warmCanvasGraphicsPipeline } from './warmCanvasGraphicsPipeline';
import { CanvasIdentityAtlasCapacityError, type CanvasIdentityAtlas } from './CanvasIdentityAtlas';
import { createCanvasCardTextureCaches } from './createCanvasCardTextureCaches';

const TEXTURE_BUDGET_BYTES = 256 * 1024 * 1024;
interface CardView extends CanvasMotionView { readonly background: NineSliceSprite; readonly body: Container; readonly label: Sprite;
  visibleAfterRender: number; firstVisibleAfterRender: number; rasterContentKey: string | undefined }

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
  try { warmCanvasGraphicsPipeline(app.renderer); }
  catch (error) { app.destroy(true, { children: true, texture: true, textureSource: true }); throw error; }
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
  private installingElements = false;
  private readonly cards = new Map<CanvasCardId, CanvasCard>();
  private readonly bitmaps: CanvasBitmapCache;
  private readonly identities: CanvasIdentityAtlas;
  private identityPreparationTask: ReturnType<typeof setTimeout> | null = null;
  private identityCapacityLimited = false;
  private readonly scene: CanvasSceneMotion;
  private readonly retiringLabels = new Set<CanvasCardId>();
  private readonly retiringViews = new Map<CanvasCardId, CardView>();
  private targets = new Map<CanvasCardId, CanvasCard>();
  private cameraStyleChanged = false;
  private readonly selected = new Set<CanvasCardId>();
  private readonly dragOriginals = new Map<CanvasCardId, CanvasCard>();
  private brush: CanvasRectangle | null = null;
  private editingCard: CanvasCardId | null = null;
  private documentTitles: ReadonlyMap<string, string> = new Map();
  private thumbnailCards: ReadonlySet<CanvasCardId> = new Set();
  private readonly identityContext: CanvasRenderingContext2D;
  private readonly identityTitles = new Map<string, string>();
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
  private readonly motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  private readonly motionChanged = () => {
    const enabled = !this.capture && !this.reduced && !this.motionPreference.matches;
    this.bitmaps.setMotionEnabled(enabled); this.scene.setEnabled(enabled);
  };
  private readonly software: boolean;
  private readonly notify?: (intent: CanvasKernelIntent) => void;
  private contextLost = false;
  private contextGeneration = 0;
  private readonly loseContext = (event: Event) => {
    event.preventDefault(); this.contextLost = true; this.contextGeneration++;
    this.notify?.({ kind: 'render-status', ...this.readRenderStatus() });
  };
  private readonly restoreContext = () => {
    this.contextLost = false;
    this.refreshCamera(true); this.notify?.({ kind: 'render-status', ...this.readRenderStatus() });
  };
  /** @canvasFrame 纯绘制闭包；内容排版和相机投影在明确的输入/异步批次阶段完成。 */
  private readonly renderFrame = () => {
    this.scheduled = 0;
    if (!this.destroyed && !this.contextLost) { this.app.render(); this.renders++; }
  };

  constructor(private readonly app: Application, options: KernelOptions, private width: number, private height: number) {
    this.canvas = app.canvas;
    const identityContext = document.createElement('canvas').getContext('2d'); if (!identityContext) throw new Error('canvas_2d_unavailable');
    this.identityContext = identityContext; identityContext.font = '15px system-ui';
    // 命中由空间索引和原生DOM事件负责，Pixi只绘制，避免第二套隐式全树扫描。
    app.stage.eventMode = 'none';
    this.capture = options.renderingMode === 'capture';
    this.software = readCanvasGpuMode(app.renderer).software;
    this.reduced = this.software && options.renderingMode !== 'capture'; this.notify = options.onIntent;
    if (this.reduced) app.renderer.resize(Math.max(1, width), Math.max(1, height), 1);
    this.lines.setReduced(this.reduced);
    this.canvas.addEventListener('webglcontextlost', this.loseContext); this.canvas.addEventListener('webglcontextrestored', this.restoreContext);
    queueMicrotask(() => { if (!this.destroyed) this.notify?.({ kind: 'render-status', ...this.readRenderStatus() }); });
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'application');
    this.canvas.setAttribute('aria-label', '自由画布，按空格拖动平移，使用工具栏编辑所选卡片');
    this.canvas.style.cssText = 'display:block;touch-action:none;width:100%;height:100%';
    options.host.append(this.canvas);
    this.world.addChild(this.cardLayer, this.guideLayer, this.selectionLayer);
    this.app.stage.addChild(this.lines.below, this.world, this.lines.above, this.mapLabels.sprite);
    const caches = createCanvasCardTextureCaches({ textureBudgetBytes: TEXTURE_BUDGET_BYTES, bitmapBudgetBytes: options.bitmapBudgetBytes ?? TEXTURE_BUDGET_BYTES,
      readRenderCount: () => this.renders, requestDraw: () => this.schedule(), changed: id => {
      // 整代安装会在末尾统一投影；资源仍已同步释放，此时不必再投影尚未换新的旧view。
      if (this.installingElements) return;
      const view = this.views.get(id); if (!this.destroyed && view) { this.updateView(view); this.schedule(); }
    } });
    this.identities = caches.identities; this.bitmaps = caches.bitmaps;
    this.scene = new CanvasSceneMotion({ project: (ids, opacity, camera) => this.projectSceneMotion(ids, opacity, camera),
      removed: id => this.removeRetiringView(id), complete: id => { const view = this.views.get(id); if (view) view.visibleAfterRender = this.renders; },
      appeared: id => { const view = this.views.get(id); if (view) view.firstVisibleAfterRender = this.renders; },
      camera: camera => this.updateCameraState(camera) });
    this.motionChanged(); this.motionPreference.addEventListener('change', this.motionChanged);
    this.removeInteraction = options.onIntent ? installCanvasInteraction(this, options.onIntent, { readonly: options.readonly, readReadonly: options.readReadonly, readPreferences: options.readInteractionPreferences }) : () => undefined;
  }
  private schedule(): void {
    if (this.destroyed || this.contextLost) return;
    if (this.identities.needsPreparation(Math.max(1, this.app.renderer.resolution))) {
      // 新字串准备前保留上一帧，不能先画出没有身份牌的纸面。
      // 独立task让同步投影、身份牌和正文准备之间有输入/绘制机会；微任务不会让出主线程。
      if (this.scheduled) { cancelAnimationFrame(this.scheduled); this.scheduled = 0; }
      if (this.identityPreparationTask === null) this.identityPreparationTask = setTimeout(() => {
        try {
          if (!this.destroyed && !this.contextLost && this.identities.needsPreparation(Math.max(1, this.app.renderer.resolution))) this.prepareIdentities();
        } finally {
          this.identityPreparationTask = null;
          // 准备失败也须清掉已撤权/移除的旧像素；原错误继续抛出，不把失败当成成功出图。
          this.scheduleDraw();
        }
      }, 0);
      return;
    }
    this.scheduleDraw();
  }
  private scheduleDraw(): void {
    if (this.destroyed || this.contextLost || this.scheduled) return;
    this.scheduled = requestAnimationFrame(this.renderFrame);
  }
  private prepareIdentities(): void {
    try { this.identities.flush(Math.max(1, this.app.renderer.resolution)); }
    catch (error) {
      if (error instanceof CanvasIdentityAtlasCapacityError) {
        this.identityCapacityLimited = true;
        this.notify?.({ kind: 'render-status', ...this.readRenderStatus() });
      }
      // 可见反馈不把失败伪装为成功，调用方仍得到原来的容量错误。
      throw error;
    }
    if (this.identityCapacityLimited) {
      this.identityCapacityLimited = false;
      this.notify?.({ kind: 'render-status', ...this.readRenderStatus() });
    }
  }
  private removeBitmap(id: CanvasCardId): void {
    this.bitmaps.remove(id);
  }
  private removeView(id: CanvasCardId): void {
    this.scene.forget(id); this.dragOriginals.delete(id);
    this.removeBitmap(id);
    const view = this.views.get(id);
    if (view) { this.identities.remove(view.label); view.container.destroy({ children: true, texture: false }); }
    this.views.delete(id);
  }
  private removeRetiringView(id: CanvasCardId): void {
    const view = this.retiringViews.get(id); if (!view) return;
    this.retiringViews.delete(id); this.retiringLabels.delete(id); this.refreshTitleOrder(); this.removeBitmap(id);
    this.identities.remove(view.label); view.container.destroy({ children: true, texture: false });
  }
  private visible(card: CanvasCard): boolean {
    return card.x * this.camera.zoom + this.camera.x <= this.width && (card.x + card.width) * this.camera.zoom + this.camera.x >= 0
      && card.y * this.camera.zoom + this.camera.y <= this.height && (card.y + card.height) * this.camera.zoom + this.camera.y >= 0;
  }
  private updateView(view: CardView): void {
    const { card, background, body, label, container } = view;
    const wasVisible = container.visible && body.visible;
    container.visible = this.exposedIds.has(card.id);
    background.texture = this.backgrounds[this.appearance.material];
    background.width = card.width;
    background.height = card.height;
    const palette = readCanvasCardPalette(card.color, this.appearance.dark);
    background.tint = palette.paper;
    // 近景身份牌必须复用纹理；连续缩放不能每个事件重新生成几百张文字纹理。
    // 字形始终烘为白色，纸色/主题通过GPU tint改变深墨；否则500次染纸会重建500张字形纹理。
    label.tint = palette.title;
    const overview = !this.keepsThumbnail(card) && this.camera.zoom < 0.3 && this.appearance.overview === 'titles';
    label.visible = this.identityVisible(card);
    body.visible = !overview && this.bitmaps.has(card.id);
    if (this.editingCard === card.id) body.visible = false;
    this.identities.setActive(label, container.visible && label.visible);
    if (!wasVisible && container.visible && body.visible) { view.visibleAfterRender = this.renders; view.firstVisibleAfterRender = this.renders; }
    const bounds = this.identityBounds(card); label.position.set(bounds.x, bounds.y);
    // 地图标题以屏幕排版框避让；卡片远景淡影不参与标题优先序。
    view.lodAlpha = this.camera.zoom < 0.15 && !this.selected.has(card.id) ? 0.6 : 1;
    this.scene.apply(view);
  }
  private identityVisible(card: CanvasCard): boolean {
    const overview = !this.keepsThumbnail(card) && this.camera.zoom < 0.3 && this.appearance.overview === 'titles';
    return this.camera.zoom >= 0.15 && this.editingCard !== card.id && !overview && this.titleExposed(card)
      && !this.bitmaps.covers(card.id, this.readVisibleCardRegions(card.id));
  }
  private identityBounds(card: CanvasCard): CanvasRectangle {
    const x = Math.min(14, card.width / 8), y = Math.min(12, card.height / 8);
    return { x, y, width: card.width - x * 2, height: card.height - y * 2 };
  }
  private identityTitle(card: CanvasCard): string {
    const source = canvasTitlePrefix(this.title(card), 120)
      || (card.type === 'image' ? '图片' : '空白卡片');
    const width = this.identityBounds(card).width, key = `${width}:${source}`, existing = this.identityTitles.get(key);
    if (existing !== undefined) return existing;
    if (this.identityTitles.size >= 4096) this.identityTitles.clear();
    const fitted = canvasFitText(source, text => this.identityContext.measureText(text).width, width);
    this.identityTitles.set(key, fitted); return fitted;
  }
  private titleExposed(card: CanvasCard): boolean {
    const region = this.identityBounds(card); if (region.height < 18) return false;
    return this.readVisibleCardRegions(card.id).some(visible => intersectCanvasRegion(region, visible) !== null);
  }
  private updateLabels(): void {
    this.mapLabels.draw({ cards: this.titleOrder, camera: this.camera, width: this.width, height: this.height,
      dark: this.appearance.dark, visible: this.camera.zoom < 0.3 && this.appearance.overview === 'titles', readTitle: card => this.title(card), readOpacity: id => this.scene.readOpacity(id) });
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
  private lineMask(): CanvasRectangle[] { return [...this.visibleRegions].flatMap(([id, regions]) => this.scene.opaque(id) ? regions : []); }
  private redrawEdges(): void {
    this.lines.setElements(this.edges, this.cards, this.lineMask());
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
    if (projection !== this.visibleRegions) {
      this.visibleRegions = projection;
      this.lines.setMask(this.lineMask());
    }
    this.exposed = this.ordered.flatMap(entry => { const card = this.cards.get(entry.id); return card && this.readVisibleCardRegions(card.id).length ? [card] : []; });
    this.exposedIds = new Set(this.exposed.map(card => card.id));
    for (const view of this.views.values()) {
      if (styleChanged) this.updateView(view);
      else {
        const wasVisible = view.container.visible;
        view.container.visible = this.exposedIds.has(view.card.id);
        if (!wasVisible && view.container.visible) { view.visibleAfterRender = this.renders; view.firstVisibleAfterRender = this.renders; }
        if (view.container.visible) {
          view.label.visible = this.identityVisible(view.card);
        }
      }
      if (view.container.visible && this.camera.zoom >= 0.3) {
        this.bitmaps.touch(view.card.id);
      }
      this.identities.setActive(view.label, view.container.visible && view.label.visible);
    }
  }

  setElements(elements: readonly CanvasElement[], options: CanvasSceneMotionOptions = {}): void {
    const nextCards = elements.filter((element): element is CanvasCard => element.type !== 'edge');
    const protectedIds = new Set(this.dragOriginals.keys()); if (this.editingCard) protectedIds.add(this.editingCard);
    const plans = planCanvasSceneMotion({ before: this.targets, after: nextCards, animateIds: options.animateIds ?? [], batch: options.batch, protectedIds });
    const byId = new Map(plans.map(plan => [plan.id, plan]));
    const nextIds = new Set(nextCards.map(card => card.id));
    this.installingElements = true;
    try {
      for (const id of this.views.keys()) if (!nextIds.has(id)) this.removeOrRetire(id, byId.get(id));
      this.cards.clear();
      for (const card of nextCards) {
        if (this.retiringViews.has(card.id)) this.scene.finish([card.id]);
        this.installCard(card, byId.get(card.id));
      }
      this.targets = new Map(nextCards.map(card => [card.id, card]));
      this.ordered = nextCards.sort((a, b) => a.order < b.order ? -1 : a.order > b.order ? 1 : 0);
      const started = performance.now();
      for (const plan of plans) {
        if (plan.kind === 'remove') continue;
        const view = this.views.get(plan.id), target = this.targets.get(plan.id);
        if (view) this.scene.start(plan, view, target, started);
      }
      this.spatial.setTranslucent(this.scene.translucentIds()); this.spatial.setCards(this.displayCards());
      this.overviewOrder = nextCards.slice().sort((a, b) => Number(b.color !== 'white') - Number(a.color !== 'white')
        || Number(b.type === 'document') - Number(a.type === 'document') || b.width * b.height - a.width * a.height);
      this.refreshOverviewCards(); this.orderViews();
      this.edges = elements.filter((element): element is CanvasEdge => element.type === 'edge');
      this.refreshCamera(true, true);
    } finally {
      // 独立失效/预算回收仍须立即更新可见性，不能被异常留下的作用域吞掉。
      this.installingElements = false;
    }
  }
  private displayCards(): CanvasCard[] { return this.ordered.flatMap(card => { const display = this.cards.get(card.id); return display ? [display] : []; }); }
  private orderViews(): void {
    const views = [...this.retiringViews.values(), ...this.views.values()].sort((a, b) => a.card.order < b.card.order ? -1 : a.card.order > b.card.order ? 1 : 0);
    for (let i = 0; i < views.length; i++) this.cardLayer.setChildIndex(views[i].container, i);
  }
  private removeOrRetire(id: CanvasCardId, plan: CanvasSceneMotionPlan | undefined): void {
    const view = this.views.get(id);
    if (!view || !plan) { this.removeView(id); return; }
    if (this.mapLabels.hasLabel(id)) this.retiringLabels.add(id);
    this.views.delete(id); this.dragOriginals.delete(id); view.card = { ...view.card }; this.retiringViews.set(id, view);
    this.scene.start(plan, view, undefined, performance.now());
  }
  private installCard(card: CanvasCard, plan: CanvasSceneMotionPlan | undefined): void {
    const previous = this.views.get(card.id);
    const projection = resolveCanvasDisplayCard({ card, previous: previous?.card, target: this.targets.get(card.id), origin: this.dragOriginals.get(card.id),
      motion: this.scene.has(card.id), editing: this.editingCard === card.id, plan });
    const display = projection.display;
    if (projection.origin) this.dragOriginals.set(card.id, projection.origin);
    else this.dragOriginals.delete(card.id);
    if (!projection.keepMotion) this.scene.forget(card.id);
    this.cards.set(card.id, display);
    // 纯位置变化不重画正文；染纸会改变同色深墨，必须和尺寸/内容变化一起淘汰。
    if (previous && canvasCardRasterChanged(previous.card, card)) this.removeBitmap(card.id);
    if (previous) {
      previous.card = display;
      this.identities.setText(previous.label, this.identityTitle(card));
    }
    // 可见片段会按container的当前显示姿态裁切；首次创建/直接移动必须先摆好位置。
    // 不能等projectCards之后的updateView才应用，否则新卡会被旧(0,0)边界误裁掉。
    this.scene.apply(previous ?? this.createView(display));
  }

  private createView(card: CanvasCard): CardView {
    const container = new Container();
    const background = new NineSliceSprite({ texture: this.backgrounds[this.appearance.material], leftWidth: 8, rightWidth: 8, topHeight: 8, bottomHeight: 8 });
    const body = new Container();
    body.visible = false;
    const label = this.identities.create(this.identityTitle(card));
    container.addChild(background, body, label);
    this.cardLayer.addChild(container);
    const view: CardView = { card, container, background, body, label, visibleAfterRender: this.renders, firstVisibleAfterRender: this.renders, rasterContentKey: undefined, lodAlpha: 1 };
    this.views.set(card.id, view); return view;
  }

  private updateCameraState(next: CanvasCamera): void {
    const zoom = this.capture ? next.zoom : Math.max(0.02, Math.min(4, next.zoom));
    this.cameraStyleChanged ||= (zoom < 0.15) !== (this.camera.zoom < 0.15) || (zoom < 0.3) !== (this.camera.zoom < 0.3);
    this.camera = { x: next.x, y: next.y, zoom };
  }
  setCamera(next: CanvasCamera): void {
    this.scene.cancelCamera();
    if (next.x === this.camera.x && next.y === this.camera.y && next.zoom === this.camera.zoom) return;
    this.updateCameraState(next); this.refreshCamera(this.cameraStyleChanged); this.cameraStyleChanged = false;
    this.redrawSelection(); this.redrawGuides();
  }
  animateCamera(camera: CanvasCamera, durationMs = 320): void { this.scene.fly(this.readCamera(), camera, durationMs); }
  finishTransitions(ids?: readonly CanvasCardId[]): void {
    this.scene.finish(ids); this.bitmaps.finishTransitions(ids); this.notify?.({ kind: 'preview-changed' });
  }
  readDisplayPosition(id: CanvasCardId): CanvasPoint | null { const view = this.views.get(id); return view ? { x: view.container.x, y: view.container.y } : null; }
  isMoving(): boolean { return this.dragOriginals.size > 0 || this.scene.isMoving(); }
  private projectSceneMotion(ids: readonly CanvasCardId[], opacityChanged: boolean, cameraChanged: boolean): void {
    if (opacityChanged) this.spatial.setTranslucent(this.scene.translucentIds());
    if (ids.length) this.spatial.updateCards(ids.flatMap(id => { const card = this.cards.get(id); return card ? [card] : []; }));
    if (ids.length || opacityChanged || cameraChanged) {
      this.refreshCamera(this.cameraStyleChanged); this.cameraStyleChanged = false;
      if (ids.length) this.lines.preview(ids, this.cards);
      this.redrawSelection(); this.redrawGuides();
    }
    this.mapLabels.invalidate(); this.updateLabels(); this.schedule();
    if (cameraChanged) this.notify?.({ kind: 'camera', camera: this.readCamera() });
    this.notify?.({ kind: 'preview-changed' });
  }

  readCamera(): CanvasCamera { return { ...this.camera }; }
  readRenderStatus(): CanvasRenderStatus {
    if (this.contextLost) return { limited: true, phase: 'restoring', message: '图形渲染正在恢复，内容已保留' };
    if (this.identityCapacityLimited) return { limited: true, phase: 'ready', message: '当前视图的卡片标题暂时无法全部显示，请放大或移动画布后重试；文档仍可编辑和保存。' };
    return { limited: this.software, phase: 'ready', message: this.software ? '当前使用软件绘图，性能受限' : null };
  }
  readResolution(): number { return this.app.renderer.resolution; }
  setSelection(ids: readonly CanvasCardId[]): void {
    if (ids.length === this.selected.size && ids.every(id => this.selected.has(id))) return;
    const previous = [...this.selected];
    this.selected.clear(); ids.forEach((id) => this.selected.add(id));
    for (const id of [...previous, ...ids]) { const view = this.views.get(id); if (view) { view.lodAlpha = this.camera.zoom < 0.15 && !this.selected.has(id) ? 0.6 : 1; this.scene.apply(view); } }
    this.refreshTitleOrder(); this.updateLabels();
    this.lines.setSelection(ids);
    this.redrawSelection(); this.schedule();
  }
  readSelection(): readonly CanvasCardId[] { return [...this.selected]; }
  hasBitmap(id: CanvasCardId, key: string): boolean { return this.bitmaps.has(id, key); }
  setRasterContentKey(id: CanvasCardId, key: string): void {
    const view = this.views.get(id); if (!view || view.rasterContentKey === key) return;
    // 内容/授权世代改变不是采样升级，旧封面和标签不能在新世代继续淡出。
    view.rasterContentKey = key; this.removeBitmap(id); this.schedule();
  }
  readRasterReceipt(id: CanvasCardId, key: string): { readonly acceptedAfterRender: number; readonly firstPresented: boolean; readonly rendered: boolean } | null {
    const accepted = this.bitmaps.readReceipt(id, key), view = this.views.get(id);
    if (accepted === null || !view) return null;
    const acceptedAfterRender = Math.max(accepted.acceptedAfterRender, view.visibleAfterRender);
    const visible = !this.contextLost && view.container.visible && view.body.visible && view.container.alpha > 0;
    // 首显只认可新层alpha真正大于0后完成的draw；alpha0首帧及仅上传纹理均不能作证。
    const firstPresented = visible && accepted.firstVisibleAfterRender !== null && this.renders > Math.max(accepted.firstVisibleAfterRender, view.firstVisibleAfterRender);
    return { acceptedAfterRender, firstPresented,
      rendered: visible && !this.bitmaps.isFading(id) && !this.scene.has(id) && this.renders > acceptedAfterRender };
  }
  setEditingCard(id: CanvasCardId | null): void {
    if (id) this.finishTransitions([id]);
    const previous = this.editingCard; this.editingCard = id;
    for (const target of [previous, id]) { if (target) { const view = this.views.get(target); if (view) this.updateView(view); } }
    this.schedule();
  }
  setBrush(rectangle: CanvasRectangle | null): void { this.brush = rectangle; this.redrawSelection(); this.schedule(); }
  setDragPreview(ids: readonly CanvasCardId[], dx: number, dy: number): void {
    this.scene.freeze(ids);
    const starting = this.dragOriginals.size === 0;
    for (const id of ids) {
      let view = this.views.get(id);
      if (!view || view.card.locked) continue;
      if (!this.dragOriginals.has(id)) {
        this.dragOriginals.set(id, view.card);
        // 只在手势开始时复制绘制投影，后续 pointermove 不逐卡分配对象。
        const display = { ...view.card };
        view.card = display;
        this.cards.set(id, display); this.views.set(id, view);
      }
      const original = this.dragOriginals.get(id);
      if (!original) continue;
      view.card.x = original.x + dx; view.card.y = original.y + dy;
      this.scene.apply(view);
    }
    if (starting) this.refreshOverviewCards();
    this.mapLabels.invalidate(); if (this.camera.zoom < 0.3) this.updateLabels();
    const movingIds = [...this.dragOriginals.keys()];
    this.spatial.updateCards(movingIds.flatMap(id => { const card = this.cards.get(id); return card ? [card] : []; }));
    this.projectCards(false);
    this.lines.preview(movingIds, this.cards); this.redrawSelection(); this.schedule();
    this.notify?.({ kind: 'preview-changed' });
  }
  clearDragPreview(): void {
    const restored: CanvasCard[] = [];
    for (const id of this.dragOriginals.keys()) {
      const target = this.targets.get(id), view = this.views.get(id);
      if (target && view) { this.cards.set(id, target); view.card = target; this.scene.apply(view); restored.push(target); }
    }
    this.spatial.updateCards(restored);
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
    const retiring = [...this.retiringLabels].flatMap(id => { const view = this.retiringViews.get(id); return view ? [view.card] : []; });
    // 只保留删除前实际展示的地图标签，不能让原先被去重的旧标题突然冒出来。
    this.titleOrder = [...retiring, ...selected, ...remaining];
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
    const camera = canvasFitCamera(rectangles, { width: this.width, height: this.height }); if (camera) this.setCamera(camera);
  }

  hitTest(point: CanvasPoint): CanvasCard | null {
    return this.spatial.hitTest(point, card => {
      const view = this.views.get(card.id); if (!view || view.container.alpha <= 0) return false;
      return point.x >= view.container.x && point.y >= view.container.y && point.x <= view.container.x + card.width * view.container.scale.x
        && point.y <= view.container.y + card.height * view.container.scale.y;
    });
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
      const visible = intersectCanvasRegion(region, viewport), view = this.views.get(id);
      if (!visible || !view) return [];
      const scale = view.container.scale.x, bounds = { x: view.container.x, y: view.container.y, width: card.width * scale, height: card.height * scale };
      const part = intersectCanvasRegion(visible, bounds);
      return part ? [{ x: (part.x - bounds.x) / scale, y: (part.y - bounds.y) / scale, width: part.width / scale, height: part.height / scale }] : [];
    });
  }
  readMissingBitmapRegions(id: CanvasCardId, key: string, regions: readonly CanvasRectangle[], resolution: { readonly scale: number; readonly exact: boolean }): readonly CanvasRectangle[] {
    return this.bitmaps.missing(id, key, regions, resolution);
  }
  hitTestEdge(point: CanvasPoint): CanvasEdge | null { return this.lines.hitTest(point); }
  setSelectedEdge(id: CanvasEdgeId | null): void { this.lines.setSelected(id); this.schedule(); }
  setHoveredCard(id: CanvasCardId | null): void { this.lines.setHovered(id); this.schedule(); }
  setDocumentTitles(titles: ReadonlyMap<string, string>): void {
    const changed = new Set<string>();
    for (const [id, title] of this.documentTitles) if (titles.get(id) !== title) changed.add(id);
    for (const [id, title] of titles) if (this.documentTitles.get(id) !== title) changed.add(id);
    if (!changed.size) return;
    this.documentTitles = new Map(titles);
    let mapChanged = false, sceneChanged = false;
    // 逐条授权元数据返回时只更新对应身份牌，不能为一张标题重新裁切2500份文本。
    for (const views of [this.views, this.retiringViews]) for (const [id, view] of views) {
      if (view.card.type !== 'document' || !changed.has(view.card.data.documentId)) continue;
      this.identities.setText(view.label, this.identityTitle(view.card)); sceneChanged ||= view.container.visible && view.label.visible;
      mapChanged ||= this.mapLabels.dependsOnTitle(id);
    }
    // 优先序不随标题变化，但拟合宽度会影响避让；已量宽的隐藏候选也可能因改短重新露出。
    if (mapChanged) { this.mapLabels.invalidate(); this.updateLabels(); }
    if (mapChanged || sceneChanged) this.schedule();
  }
  setThumbnailCards(ids: ReadonlySet<CanvasCardId>): void {
    const changed = new Set<CanvasCardId>();
    for (const id of this.thumbnailCards) if (!ids.has(id)) changed.add(id);
    for (const id of ids) if (!this.thumbnailCards.has(id)) changed.add(id);
    if (!changed.size) return;
    const mapChanged = [...changed].some(id => !ids.has(id) || this.mapLabels.hasLabel(id));
    this.thumbnailCards = new Set(ids);
    // 缩略偏好不改变位置或遮挡；仅重投影变化卡的正文/身份牌可见性。
    for (const id of changed) { const view = this.views.get(id); if (view) this.updateView(view); }
    this.refreshTitleOrder();
    if (mapChanged) { this.mapLabels.invalidate(); this.updateLabels(); }
    this.schedule();
  }
  readEdgeGeometry(id: CanvasEdgeId) { return this.lines.readGeometry(id); }
  screenToWorld(point: CanvasPoint): CanvasPoint { return canvasScreenToWorld(point, this.camera); }
  worldToScreen(point: CanvasPoint): CanvasPoint { return canvasWorldToScreen(point, this.camera); }
  async captureImage(format: 'png' | 'jpeg', quality = 0.9): Promise<string> {
    if (this.contextLost) throw new Error('canvas_graphics_context_lost');
    this.prepareIdentities();
    const generation = this.contextGeneration;
    const result = await this.app.renderer.extract.base64({ target: this.app.stage, format: format === 'jpeg' ? 'jpg' : 'png',
      quality, frame: new Rectangle(0, 0, this.width, this.height), resolution: this.app.renderer.resolution,
      clearColor: this.appearance.dark ? '#222723' : '#f2f3ee' });
    if (this.contextLost || generation !== this.contextGeneration) throw new Error('canvas_graphics_context_lost');
    return result;
  }
  readStats() {
    const bitmaps = this.bitmaps.readStats(), identities = this.identities.readStats();
    return { viewportCards: this.visibleCards().length, renderableCards: this.exposed.length, rasterCards: this.rasterCards().length,
      cards: this.cards.size, edges: this.edges.length, renders: this.renders, ...bitmaps, ...identities,
      estimatedTextureBytes: bitmaps.bitmapBytes + identities.identityBytes, textureBudgetBytes: TEXTURE_BUDGET_BYTES,
      ...this.scene.readStats(), ...this.lines.readStats(), ...this.spatial.readStats() };
  }
  destroy(): void {
    this.destroyed = true; this.scene.dispose();
    this.motionPreference.removeEventListener('change', this.motionChanged);
    if (this.identityPreparationTask !== null) { clearTimeout(this.identityPreparationTask); this.identityPreparationTask = null; }
    if (this.scheduled) cancelAnimationFrame(this.scheduled);
    this.removeInteraction();
    this.canvas.removeEventListener('webglcontextlost', this.loseContext); this.canvas.removeEventListener('webglcontextrestored', this.restoreContext);
    this.canvas.remove();
    this.invalidateBitmaps(); this.identities.destroy(); this.mapLabels.destroy(); this.lines.destroy();
    this.views.clear(); this.retiringViews.clear(); this.retiringLabels.clear(); this.identityTitles.clear(); this.cards.clear(); this.targets.clear();
    // HTML paint事件兑现的Promise仍在Chromium原生paint回调的微任务中。
    // 此时WEBGL_lose_context会使Renderer进程崩溃；下一task完整释放GPU，逻辑关闭立即生效。
    setTimeout(() => {
      this.app.destroy({ removeView: true }, { children: true, texture: false });
      this.backgrounds.paper.destroy(true); this.backgrounds.card.destroy(true);
    }, 0);
  }
}
