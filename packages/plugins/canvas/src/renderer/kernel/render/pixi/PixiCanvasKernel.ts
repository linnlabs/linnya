import { CanvasSelectionProjection } from './CanvasSelectionProjection';
import { CanvasCardPreview } from './CanvasCardPreview';
import { CanvasCardPresentation } from './CanvasCardPresentation';
import { createCanvasCardBackgrounds } from './createCanvasCardBackground';
import type { CanvasCardView } from './definitions/canvasCardView';
import type { CanvasKernelOptions } from '../../definitions/canvasKernelOptions';
import {
  DEFAULT_CANVAS_KERNEL_TEXT,
  type CanvasKernelText,
} from '../../definitions/canvasKernelText';
import { Container, type Application } from 'pixi.js';
import {
  canvasScreenToWorld,
  canvasWorldToScreen,
  type CanvasCamera,
  type CanvasCard,
  type CanvasCardId,
  type CanvasEdge,
  type CanvasEdgeId,
  type CanvasElement,
  type CanvasPoint,
  type CanvasRectangle,
} from '../../../../shared';
import type {
  CanvasAppearance,
  CanvasGuide,
  CanvasKernel,
  CanvasKernelIntent,
  CanvasRasterTile,
  CanvasRenderStatus,
  CanvasSceneMotionOptions,
  CanvasSelectionFrame,
} from '../../definitions/canvasKernel';
import { installCanvasInteraction } from '../../interaction/installCanvasInteraction';
import { CanvasMapLabels } from './CanvasMapLabels';
import { CanvasLines } from './CanvasLines';
import { CanvasSpatialProjection } from '../../geometry/CanvasSpatialProjection';
import { readCanvasGpuMode } from './readCanvasGpuMode';
import type { CanvasBitmapCache } from './CanvasBitmapCache';
import { CanvasSceneMotion } from './CanvasSceneMotion';
import {
  planCanvasSceneMotion,
  resolveCanvasDisplayCard,
  canvasCardContentChanged,
  canvasCardRasterChanged,
  type CanvasSceneMotionPlan,
} from '../../motion';
import { canvasFitCamera } from '../../geometry/canvasFitCamera';
import type { CanvasIdentityAtlas } from './CanvasIdentityAtlas';
import { CanvasFrameDrawing } from './CanvasFrameDrawing';
import { canvasStandaloneChrome } from './canvasStandaloneChrome';
import { createCanvasCardTextureCaches } from './createCanvasCardTextureCaches';

const TEXTURE_BUDGET_BYTES = 256 * 1024 * 1024;

export class PixiCanvasKernel implements CanvasKernel {
  readonly canvas: HTMLCanvasElement;
  private readonly world = new Container({ isRenderGroup: true });
  private readonly lines = new CanvasLines();
  private readonly cardLayer = new Container();
  private readonly backgrounds = createCanvasCardBackgrounds();
  private readonly views = new Map<CanvasCardId, CanvasCardView>();
  private installingElements = false;
  private readonly cards = new Map<CanvasCardId, CanvasCard>();
  private readonly bitmaps: CanvasBitmapCache;
  private readonly identities: CanvasIdentityAtlas;
  private readonly presentation: CanvasCardPresentation;
  private readonly scene: CanvasSceneMotion;
  private readonly retiringLabels = new Set<CanvasCardId>();
  private readonly retiringViews = new Map<CanvasCardId, CanvasCardView>();
  private targets = new Map<CanvasCardId, CanvasCard>();
  private cameraStyleChanged = false;
  private readonly selected = new Set<CanvasCardId>();
  private readonly selectionProjection = new CanvasSelectionProjection(this.cards, this.selected);
  private readonly dragOriginals = new Map<CanvasCardId, CanvasCard>();
  private readonly preview = new CanvasCardPreview({
    views: this.views,
    cards: this.cards,
    originals: this.dragOriginals,
    freeze: ids => this.scene.freeze(ids),
    move: view => this.scene.apply(view),
    resize: view => this.presentation.updateView(view),
    readMaterial: () => this.appearance.material,
  });
  private editingCard: CanvasCardId | null = null;
  private readonly text: CanvasKernelText;
  private readonly mapLabels: CanvasMapLabels;
  private overviewOrder: readonly CanvasCard[] = [];
  private titleOrder: readonly CanvasCard[] = [];
  private edges: readonly CanvasEdge[] = [];
  private ordered: readonly CanvasCard[] = [];
  private readonly spatial = new CanvasSpatialProjection();
  private camera: CanvasCamera = { x: 0, y: 0, zoom: 1 };
  private appearance: CanvasAppearance = { dark: false, material: 'paper', overview: 'titles' };
  private readonly removeInteraction: () => void;
  private readonly reduced: boolean;
  private readonly capture: boolean;
  private readonly motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  private readonly motionChanged = () => {
    const enabled = !this.capture && !this.reduced && !this.motionPreference.matches;
    this.bitmaps.setMotionEnabled(enabled);
    this.scene.setEnabled(enabled);
  };
  private readonly software: boolean;
  private readonly drawing: CanvasFrameDrawing;
  private readonly notify?: (intent: CanvasKernelIntent) => void;

  constructor(
    private readonly app: Application,
    options: CanvasKernelOptions,
    private width: number,
    private height: number
  ) {
    this.text = options.text ?? DEFAULT_CANVAS_KERNEL_TEXT;
    this.mapLabels = new CanvasMapLabels(this.text.blankTitle);
    this.canvas = app.canvas;
    const identityContext = document.createElement('canvas').getContext('2d');
    if (!identityContext) throw new Error('canvas_2d_unavailable');
    identityContext.font = '15px system-ui';
    // 命中由空间索引和原生DOM事件负责，Pixi只绘制，避免第二套隐式全树扫描。
    app.stage.eventMode = 'none';
    this.capture = options.renderingMode === 'capture';
    this.software = readCanvasGpuMode(app.renderer).software;
    this.reduced = this.software && options.renderingMode !== 'capture';
    this.notify = options.onIntent;
    if (this.reduced) app.renderer.resize(Math.max(1, width), Math.max(1, height), 1);
    this.lines.setReduced(this.reduced);
    this.drawing = new CanvasFrameDrawing(app, {
      readIdentities: () => this.identities,
      readCaptureFrame: () => ({
        width: this.width,
        height: this.height,
        background: (this.appearance.chrome ?? canvasStandaloneChrome(this.appearance.dark))
          .background,
      }),
      restored: () => this.refreshCamera(true),
      software: this.software,
      text: this.text,
      notify: this.notify,
    });
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'application');
    this.canvas.setAttribute('aria-label', this.text.surfaceLabel());
    this.canvas.style.cssText = 'display:block;touch-action:none;width:100%;height:100%';
    options.host.append(this.canvas);
    this.world.addChild(
      this.cardLayer,
      this.selectionProjection.guideLayer,
      this.selectionProjection.selectionLayer
    );
    this.app.stage.addChild(this.lines.below, this.world, this.lines.above, this.mapLabels.sprite);
    const caches = createCanvasCardTextureCaches({
      textureBudgetBytes: TEXTURE_BUDGET_BYTES,
      bitmapBudgetBytes: options.bitmapBudgetBytes ?? TEXTURE_BUDGET_BYTES,
      readRenderCount: () => this.drawing.readRenderCount(),
      requestDraw: () => this.drawing.schedule(),
      changed: id => {
        // 整代安装会在末尾统一投影；资源仍已同步释放，此时不必再投影尚未换新的旧view。
        if (this.installingElements) return;
        const view = this.views.get(id);
        if (!this.drawing.isDestroyed() && view) {
          this.presentation.updateView(view);
          this.drawing.schedule();
        }
      },
    });
    this.identities = caches.identities;
    this.bitmaps = caches.bitmaps;
    this.presentation = this.createPresentation(identityContext);
    this.scene = new CanvasSceneMotion({
      project: (ids, opacity, camera) => this.projectSceneMotion(ids, opacity, camera),
      removed: id => this.removeRetiringView(id),
      complete: id => {
        const view = this.views.get(id);
        if (view) view.visibleAfterRender = this.drawing.readRenderCount();
      },
      appeared: id => {
        const view = this.views.get(id);
        if (view) view.firstVisibleAfterRender = this.drawing.readRenderCount();
      },
      camera: camera => this.updateCameraState(camera),
    });
    this.motionChanged();
    this.motionPreference.addEventListener('change', this.motionChanged);
    this.removeInteraction = options.onIntent
      ? installCanvasInteraction(this, options.onIntent, {
          readonly: options.readonly,
          readReadonly: options.readReadonly,
          readPreferences: options.readInteractionPreferences,
        })
      : () => undefined;
  }
  private removeView(id: CanvasCardId): void {
    this.scene.forget(id);
    this.dragOriginals.delete(id);
    this.bitmaps.remove(id);
    const view = this.views.get(id);
    if (view) {
      this.identities.remove(view.label);
      view.container.destroy({ children: true, texture: false });
    }
    this.views.delete(id);
  }
  private removeRetiringView(id: CanvasCardId): void {
    const view = this.retiringViews.get(id);
    if (!view) return;
    this.retiringViews.delete(id);
    this.retiringLabels.delete(id);
    this.refreshTitleOrder();
    this.bitmaps.remove(id);
    this.identities.remove(view.label);
    view.container.destroy({ children: true, texture: false });
  }
  private updateLabels(): void {
    this.mapLabels.draw({
      cards: this.titleOrder,
      camera: this.camera,
      width: this.width,
      height: this.height,
      dark: this.appearance.dark,
      visible: this.camera.zoom < 0.3 && this.appearance.overview === 'titles',
      readTitle: card => this.presentation.title(card),
      readOpacity: id => this.scene.readOpacity(id),
    });
  }
  private redrawGuides(): void {
    this.selectionProjection.drawGuides(this.camera.zoom);
  }
  private repaintSelection(): void {
    this.selectionProjection.drawSelection(this.camera.zoom);
    this.drawing.schedule();
  }
  setGuides(guides: readonly CanvasGuide[]): void {
    this.selectionProjection.setGuides(guides);
    this.redrawGuides();
    this.drawing.schedule();
  }
  private lineMask(): CanvasRectangle[] {
    return [...this.presentation.readRegions()].flatMap(([id, regions]) =>
      this.scene.opaque(id) ? regions : []
    );
  }
  private redrawEdges(): void {
    this.lines.setElements(this.edges, this.cards, this.lineMask());
  }
  private refreshCamera(styleChanged = false, edgesChanged = false): void {
    this.world.position.set(this.camera.x, this.camera.y);
    this.world.scale.set(this.camera.zoom);
    this.presentation.projectCards(styleChanged);
    this.updateLabels();
    if (styleChanged) this.selectionProjection.drawSelection(this.camera.zoom);
    if (edgesChanged) this.redrawEdges();
    this.lines.setCamera(this.camera, this.width, this.height, this.app.renderer.resolution);
    this.drawing.schedule();
  }

  setElements(elements: readonly CanvasElement[], options: CanvasSceneMotionOptions = {}): void {
    const nextCards = elements.filter((element): element is CanvasCard => element.type !== 'edge');
    const protectedIds = new Set(this.dragOriginals.keys());
    if (this.editingCard) protectedIds.add(this.editingCard);
    const plans = planCanvasSceneMotion({
      before: this.targets,
      after: nextCards,
      animateIds: options.animateIds ?? [],
      batch: options.batch,
      protectedIds,
    });
    const byId = new Map(plans.map(plan => [plan.id, plan]));
    const nextIds = new Set(nextCards.map(card => card.id));
    this.installingElements = true;
    try {
      for (const id of this.views.keys())
        if (!nextIds.has(id)) this.removeOrRetire(id, byId.get(id));
      this.cards.clear();
      for (const card of nextCards) {
        if (this.retiringViews.has(card.id)) this.scene.finish([card.id]);
        this.installCard(card, byId.get(card.id));
      }
      this.targets = new Map(nextCards.map(card => [card.id, card]));
      this.ordered = nextCards.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
      const started = performance.now();
      for (const plan of plans) {
        if (plan.kind === 'remove') continue;
        const view = this.views.get(plan.id),
          target = this.targets.get(plan.id);
        if (view) this.scene.start(plan, view, target, started);
      }
      this.spatial.setTranslucent(this.scene.translucentIds());
      this.spatial.setCards(this.presentation.displayCards());
      this.overviewOrder = nextCards
        .slice()
        .sort(
          (a, b) =>
            Number(b.color !== 'white') - Number(a.color !== 'white') ||
            Number(b.type === 'document') - Number(a.type === 'document') ||
            b.width * b.height - a.width * a.height
        );
      this.refreshOverviewCards();
      this.presentation.orderViews();
      this.edges = elements.filter((element): element is CanvasEdge => element.type === 'edge');
      this.refreshCamera(true, true);
    } finally {
      // 独立失效/预算回收仍须立即更新可见性，不能被异常留下的作用域吞掉。
      this.installingElements = false;
    }
  }
  private removeOrRetire(id: CanvasCardId, plan: CanvasSceneMotionPlan | undefined): void {
    const view = this.views.get(id);
    if (!view || !plan) {
      this.removeView(id);
      return;
    }
    if (this.mapLabels.hasLabel(id)) this.retiringLabels.add(id);
    this.views.delete(id);
    this.dragOriginals.delete(id);
    view.card = { ...view.card };
    this.retiringViews.set(id, view);
    this.scene.start(plan, view, undefined, performance.now());
  }
  private installCard(card: CanvasCard, plan: CanvasSceneMotionPlan | undefined): void {
    const previous = this.views.get(card.id);
    const projection = resolveCanvasDisplayCard({
      card,
      previous: previous?.card,
      target: this.targets.get(card.id),
      origin: this.dragOriginals.get(card.id),
      motion: this.scene.has(card.id),
      editing: this.editingCard === card.id,
      plan,
    });
    const display = projection.display;
    if (projection.origin) this.dragOriginals.set(card.id, projection.origin);
    else this.dragOriginals.delete(card.id);
    if (!projection.keepMotion) this.scene.forget(card.id);
    this.cards.set(card.id, display);
    // 纯位置变化不重画正文；染纸会改变同色深墨，必须和尺寸/内容变化一起淘汰。
    // 改尺寸落地时旧排版仍是同一份正文：留着裁在新纸面里，等新排版原地替换，松手那一帧不空白。
    if (
      previous &&
      canvasCardRasterChanged(previous.card, card) &&
      !(this.preview.showsOldLayout(card.id) && !canvasCardContentChanged(previous.card, card))
    )
      this.bitmaps.remove(card.id);
    if (previous) {
      previous.card = display;
      this.identities.setText(previous.label, this.presentation.identityTitle(card));
    }
    // 可见片段会按container的当前显示姿态裁切；首次创建/直接移动必须先摆好位置。
    // 不能等projectCards之后的updateView才应用，否则新卡会被旧(0,0)边界误裁掉。
    this.scene.apply(previous ?? this.createView(display));
  }

  private createView(card: CanvasCard): CanvasCardView {
    const view = this.presentation.createView(card);
    this.views.set(card.id, view);
    return view;
  }
  private createPresentation(identityContext: CanvasRenderingContext2D): CanvasCardPresentation {
    return new CanvasCardPresentation({
      text: this.text,
      backgrounds: this.backgrounds,
      identityContext,
      context: {
        readCamera: () => this.camera,
        readWidth: () => this.width,
        readHeight: () => this.height,
        readAppearance: () => this.appearance,
        selected: this.selected,
        readEditingCard: () => this.editingCard,
        showsOldLayout: id => this.preview.showsOldLayout(id),
        readRenders: () => this.drawing.readRenderCount(),
        readContextLost: () => this.drawing.hasContextLost(),
        readDestroyed: () => this.drawing.isDestroyed(),
      },
      layer: this.cardLayer,
      bitmaps: this.bitmaps,
      identities: this.identities,
      mapLabels: this.mapLabels,
      views: this.views,
      retiringViews: this.retiringViews,
      cards: this.cards,
      spatial: this.spatial,
      readOrdered: () => this.ordered,
      maskChanged: () => this.lines.setMask(this.lineMask()),
      hasMotion: id => this.scene.has(id),
      applyMotion: view => this.scene.apply(view),
      refreshTitleOrder: () => this.refreshTitleOrder(),
      updateLabels: () => this.updateLabels(),
      schedule: () => this.drawing.schedule(),
    });
  }
  setDocumentTitles(titles: ReadonlyMap<string, string>): void {
    this.presentation.setDocumentTitles(titles);
  }
  setThumbnailCards(ids: ReadonlySet<CanvasCardId>): void {
    this.presentation.setThumbnailCards(ids);
  }
  setRasterContentKey(id: CanvasCardId, key: string): void {
    this.presentation.setRasterContentKey(id, key);
  }
  readRasterReceipt(id: CanvasCardId, key: string): ReturnType<CanvasKernel['readRasterReceipt']> {
    return this.presentation.readRasterReceipt(id, key);
  }
  setBitmap(id: CanvasCardId, revision: number, key: string, bitmap: ImageBitmap): boolean {
    return this.installed(id, revision, () =>
      this.presentation.setBitmap(id, revision, key, bitmap)
    );
  }
  setRasterTiles(
    id: CanvasCardId,
    revision: number,
    key: string,
    tiles: readonly CanvasRasterTile[]
  ): boolean {
    return this.installed(id, revision, () =>
      this.presentation.setRasterTiles(id, revision, key, tiles)
    );
  }
  private installed(id: CanvasCardId, revision: number, install: () => boolean): boolean {
    // 改尺寸后的新排版直接替换旧排版：两种宽度的正文交叉淡变会叠出重影。
    if (this.cards.get(id)?.revision === revision && this.preview.takeSwap(id))
      this.bitmaps.remove(id);
    const accepted = install();
    if (accepted) this.preview.contentInstalled(id);
    return accepted;
  }
  visibleCards(): readonly CanvasCard[] {
    return this.presentation.visibleCards();
  }
  renderableCards(): readonly CanvasCard[] {
    return this.presentation.renderableCards();
  }
  rasterCards(): readonly CanvasCard[] {
    // 改尺寸预览中的显示副本仍是旧修订，按它排版会把新宽度的正文记在旧版本名下。
    const cards = this.presentation.rasterCards();
    const resizing = this.preview.resizing;
    return resizing ? cards.filter(card => card.id !== resizing) : cards;
  }
  readVisibleCardRegions(id: CanvasCardId): readonly CanvasRectangle[] {
    return this.presentation.readVisibleCardRegions(id);
  }
  private updateCameraState(next: CanvasCamera): void {
    const zoom = this.capture ? next.zoom : Math.max(0.02, Math.min(4, next.zoom));
    this.cameraStyleChanged ||=
      zoom < 0.15 !== this.camera.zoom < 0.15 || zoom < 0.3 !== this.camera.zoom < 0.3;
    this.camera = { x: next.x, y: next.y, zoom };
  }
  setCamera(next: CanvasCamera): void {
    this.scene.cancelCamera();
    if (next.x === this.camera.x && next.y === this.camera.y && next.zoom === this.camera.zoom)
      return;
    this.updateCameraState(next);
    this.refreshCamera(this.cameraStyleChanged);
    this.cameraStyleChanged = false;
    this.selectionProjection.drawSelection(this.camera.zoom);
    this.redrawGuides();
  }
  animateCamera(camera: CanvasCamera, durationMs = 320): void {
    this.scene.fly(this.readCamera(), camera, durationMs);
  }
  finishTransitions(ids?: readonly CanvasCardId[]): void {
    this.scene.finish(ids);
    this.bitmaps.finishTransitions(ids);
    this.notify?.({ kind: 'preview-changed' });
  }
  readDisplayPosition(id: CanvasCardId): CanvasPoint | null {
    const view = this.views.get(id);
    return view ? { x: view.container.x, y: view.container.y } : null;
  }
  isMoving(): boolean {
    return this.dragOriginals.size > 0 || this.scene.isMoving();
  }
  private projectSceneMotion(
    ids: readonly CanvasCardId[],
    opacityChanged: boolean,
    cameraChanged: boolean
  ): void {
    if (opacityChanged) this.spatial.setTranslucent(this.scene.translucentIds());
    if (ids.length)
      this.spatial.updateCards(
        ids.flatMap(id => {
          const card = this.cards.get(id);
          return card ? [card] : [];
        })
      );
    if (ids.length || opacityChanged || cameraChanged) {
      this.refreshCamera(this.cameraStyleChanged);
      this.cameraStyleChanged = false;
      if (ids.length) this.lines.preview(ids, this.cards);
      this.selectionProjection.drawSelection(this.camera.zoom);
      this.redrawGuides();
    }
    this.mapLabels.invalidate();
    this.updateLabels();
    this.drawing.schedule();
    if (cameraChanged) this.notify?.({ kind: 'camera', camera: this.readCamera() });
    this.notify?.({ kind: 'preview-changed' });
  }

  readCamera(): CanvasCamera {
    return { ...this.camera };
  }
  readRenderStatus(): CanvasRenderStatus {
    return this.drawing.readRenderStatus();
  }
  captureImage(format: 'png' | 'jpeg', quality = 0.9): Promise<string> {
    return this.drawing.captureImage(format, quality);
  }
  readResolution(): number {
    return this.app.renderer.resolution;
  }
  setSelection(ids: readonly CanvasCardId[]): void {
    if (ids.length === this.selected.size && ids.every(id => this.selected.has(id))) return;
    const previous = [...this.selected];
    this.selected.clear();
    ids.forEach(id => this.selected.add(id));
    for (const id of [...previous, ...ids]) {
      const view = this.views.get(id);
      if (!view) continue;
      view.lodAlpha = this.camera.zoom < 0.15 && !this.selected.has(id) ? 0.6 : 1;
      this.scene.apply(view);
    }
    this.refreshTitleOrder();
    this.updateLabels();
    this.lines.setSelection(ids);
    this.repaintSelection();
  }
  readSelection(): readonly CanvasCardId[] {
    return [...this.selected];
  }
  hasBitmap(id: CanvasCardId, key: string): boolean {
    return this.bitmaps.has(id, key);
  }
  setEditingCard(id: CanvasCardId | null): void {
    if (id) this.finishTransitions([id]);
    const previous = this.editingCard;
    this.editingCard = id;
    for (const target of [previous, id]) {
      const view = target ? this.views.get(target) : undefined;
      if (view) this.presentation.updateView(view);
    }
    this.drawing.schedule();
  }
  setSelectionFrame(frame: CanvasSelectionFrame | null): void {
    this.selectionProjection.setFrame(frame);
    this.repaintSelection();
  }
  setBrush(rectangle: CanvasRectangle | null): void {
    this.selectionProjection.setBrush(rectangle);
    this.repaintSelection();
  }
  setDragPreview(ids: readonly CanvasCardId[], dx: number, dy: number): void {
    const starting = this.preview.place(ids, (card, original) => {
      card.x = original.x + dx;
      card.y = original.y + dy;
    });
    this.previewChanged(starting);
  }
  /** 改尺寸与拖动共用预览通道：纸面、连线、描边逐帧跟随；正文旧排版裁在纸面内，提交后重排。 */
  setResizePreview(id: CanvasCardId, frame: CanvasRectangle): void {
    this.previewChanged(this.preview.resize(id, frame));
  }
  private previewChanged(starting: boolean): void {
    if (starting) this.refreshOverviewCards();
    this.mapLabels.invalidate();
    if (this.camera.zoom < 0.3) this.updateLabels();
    const movingIds = [...this.dragOriginals.keys()];
    this.spatial.updateCards(movingIds.flatMap(id => this.cards.get(id) ?? []));
    this.presentation.projectCards(false);
    this.lines.preview(movingIds, this.cards);
    this.repaintSelection();
    this.notify?.({ kind: 'preview-changed' });
  }
  clearDragPreview(): void {
    this.spatial.updateCards(this.preview.restore(this.targets));
    this.refreshOverviewCards();
    this.mapLabels.invalidate();
    this.updateLabels();
    this.presentation.projectCards(false);
    this.redrawEdges();
    this.repaintSelection();
    this.notify?.({ kind: 'preview-changed' });
  }

  private refreshTitleOrder(): void {
    const selected: CanvasCard[] = [],
      remaining: CanvasCard[] = [];
    for (const card of this.overviewOrder) {
      if (this.presentation.keepsThumbnail(card)) continue;
      (this.selected.has(card.id) ? selected : remaining).push(card);
    }
    // 只作稳定分区，保留颜色/文档/面积原优先序；选择不需要重新排序整张画布。
    const retiring = [...this.retiringLabels].flatMap(id => {
      const view = this.retiringViews.get(id);
      return view ? [view.card] : [];
    });
    // 只保留删除前实际展示的地图标签，不能让原先被去重的旧标题突然冒出来。
    this.titleOrder = [...retiring, ...selected, ...remaining];
  }
  private refreshOverviewCards(): void {
    this.overviewOrder = this.overviewOrder.map(card => this.cards.get(card.id) ?? card);
    this.refreshTitleOrder();
  }
  invalidateBitmaps(): void {
    this.bitmaps.clear();
    this.drawing.schedule();
  }
  setAppearance(next: CanvasAppearance): void {
    if (next.dark !== this.appearance.dark) this.invalidateBitmaps();
    const materialChanged = next.material !== this.appearance.material;
    this.appearance = next;
    if (materialChanged) this.preview.refitClip();
    this.selectionProjection.setAppearance(next);
    this.lines.setAppearance(next);
    this.refreshCamera(true);
  }
  resize(width: number, height: number, resolution?: number): void {
    this.width = width;
    this.height = height;
    this.app.renderer.resize(
      Math.max(1, width),
      Math.max(1, height),
      this.reduced ? Math.min(1, resolution ?? this.app.renderer.resolution) : resolution
    );
    this.refreshCamera(true);
    this.drawing.drawNow();
  }
  fit(rectangles: readonly CanvasRectangle[]): void {
    const camera = canvasFitCamera(rectangles, { width: this.width, height: this.height });
    if (camera) this.setCamera(camera);
  }

  hitTest(point: CanvasPoint): CanvasCard | null {
    return this.spatial.hitTest(point, card => {
      const view = this.views.get(card.id);
      if (!view || view.container.alpha <= 0) return false;
      return (
        point.x >= view.container.x &&
        point.y >= view.container.y &&
        point.x <= view.container.x + card.width * view.container.scale.x &&
        point.y <= view.container.y + card.height * view.container.scale.y
      );
    });
  }
  readCard(id: CanvasCardId): CanvasCard | null {
    return this.cards.get(id) ?? null;
  }
  readMissingBitmapRegions(
    id: CanvasCardId,
    key: string,
    regions: readonly CanvasRectangle[],
    resolution: { readonly scale: number; readonly exact: boolean }
  ): readonly CanvasRectangle[] {
    return this.bitmaps.missing(id, key, regions, resolution);
  }
  hitTestEdge(point: CanvasPoint): CanvasEdge | null {
    return this.lines.hitTest(point);
  }
  setSelectedEdge(id: CanvasEdgeId | null): void {
    this.lines.setSelected(id);
    this.drawing.schedule();
  }
  setHoveredCard(id: CanvasCardId | null): void {
    this.lines.setHovered(id);
    this.drawing.schedule();
  }
  readEdgeGeometry(id: CanvasEdgeId) {
    return this.lines.readGeometry(id);
  }
  screenToWorld(point: CanvasPoint): CanvasPoint {
    return canvasScreenToWorld(point, this.camera);
  }
  worldToScreen(point: CanvasPoint): CanvasPoint {
    return canvasWorldToScreen(point, this.camera);
  }
  readStats() {
    const bitmaps = this.bitmaps.readStats(),
      identities = this.identities.readStats();
    return {
      viewportCards: this.visibleCards().length,
      renderableCards: this.presentation.renderableCards().length,
      rasterCards: this.rasterCards().length,
      cards: this.cards.size,
      edges: this.edges.length,
      renders: this.drawing.readRenderCount(),
      ...bitmaps,
      ...identities,
      estimatedTextureBytes: bitmaps.bitmapBytes + identities.identityBytes,
      textureBudgetBytes: TEXTURE_BUDGET_BYTES,
      ...this.scene.readStats(),
      ...this.lines.readStats(),
      ...this.spatial.readStats(),
    };
  }
  destroy(): void {
    this.drawing.stop();
    this.scene.dispose();
    this.motionPreference.removeEventListener('change', this.motionChanged);
    this.drawing.dispose(this.removeInteraction);
    this.invalidateBitmaps();
    this.identities.destroy();
    this.mapLabels.destroy();
    this.lines.destroy();
    this.preview.destroy();
    this.views.clear();
    this.retiringViews.clear();
    this.retiringLabels.clear();
    this.presentation.clearTitles();
    this.cards.clear();
    this.targets.clear();
    // HTML paint事件兑现的Promise仍在Chromium原生paint回调的微任务中。
    // 此时WEBGL_lose_context会使Renderer进程崩溃；下一task完整释放GPU，逻辑关闭立即生效。
    setTimeout(() => {
      this.app.destroy({ removeView: true }, { children: true, texture: false });
      this.presentation.destroyBackgrounds();
    }, 0);
  }
}
