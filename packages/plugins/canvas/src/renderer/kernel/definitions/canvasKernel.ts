import type {
  CanvasCamera,
  CanvasCard,
  CanvasCardId,
  CanvasEdge,
  CanvasEdgeId,
  CanvasElement,
  CanvasPoint,
  CanvasRectangle,
} from '../../../shared';
import type { CanvasSpatialProjectionStats } from './canvasSpatialProjection';
import type { CanvasEdgeGeometry } from '../geometry/canvasEdgeGeometry';

export type CanvasKernelIntent =
  | { readonly kind: 'preview-changed' }
  | {
      readonly kind: 'hover';
      readonly id: CanvasCardId | null;
      readonly edgeId: CanvasEdgeId | null;
    }
  | { readonly kind: 'select'; readonly ids: readonly CanvasCardId[]; readonly additive: boolean }
  | { readonly kind: 'select-edge'; readonly id: CanvasEdgeId | null }
  | {
      readonly kind: 'move';
      readonly ids: readonly CanvasCardId[];
      readonly positions: readonly CanvasCardPosition[];
      readonly dx: number;
      readonly dy: number;
      readonly copy?: boolean;
    }
  | { readonly kind: 'editing'; readonly ids: readonly CanvasCardId[]; readonly active: boolean }
  | { readonly kind: 'open'; readonly id: CanvasCardId }
  | {
      readonly kind: 'context';
      readonly point: CanvasPoint;
      readonly id: CanvasCardId | null;
      readonly edgeId?: CanvasEdgeId | null;
    }
  | { readonly kind: 'camera'; readonly camera: CanvasCamera }
  | ({ readonly kind: 'render-status' } & CanvasRenderStatus);
export interface CanvasRenderStatus {
  readonly limited: boolean;
  readonly phase: 'ready' | 'restoring';
  readonly message: string | null;
}
export interface CanvasGuide {
  readonly from: CanvasPoint;
  readonly to: CanvasPoint;
}
export interface CanvasCardPosition extends CanvasPoint {
  readonly id: CanvasCardId;
}
export interface CanvasSceneMotionOptions {
  readonly animateIds?: readonly CanvasCardId[];
  readonly batch?: boolean;
}
/** 画布里属于界面而不是内容的颜色：选中与参考线、页面底色、连线墨色与标签字色。 */
export interface CanvasChromeColors {
  readonly accent: number;
  readonly background: number;
  readonly ink: number;
  readonly label: number;
}
/** 选中描边的实时外框；id 为 null 表示尚未提交的新卡。 */
export interface CanvasSelectionFrame {
  readonly id: CanvasCardId | null;
  readonly rectangle: CanvasRectangle;
}
export interface CanvasAppearance {
  readonly dark: boolean;
  readonly material: 'paper' | 'card';
  readonly overview: 'titles' | 'thumbnails';
  /** 有 DOM 主题的窗口由 Renderer UI token 解析；隐藏出图 worker 与探针没有主题，用画布自带浅/深色。 */
  readonly chrome?: CanvasChromeColors;
}
export interface CanvasRasterTile {
  readonly bitmap: ImageBitmap;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
}
export interface CanvasKernel {
  readonly canvas: HTMLCanvasElement;
  setElements(elements: readonly CanvasElement[], options?: CanvasSceneMotionOptions): void;
  setCamera(camera: CanvasCamera): void;
  readCamera(): CanvasCamera;
  animateCamera(camera: CanvasCamera, durationMs?: number): void;
  finishTransitions(ids?: readonly CanvasCardId[]): void;
  readDisplayPosition(id: CanvasCardId): CanvasPoint | null;
  isMoving(): boolean;
  readRenderStatus(): CanvasRenderStatus;
  readResolution(): number;
  setSelection(ids: readonly CanvasCardId[]): void;
  readSelection(): readonly CanvasCardId[];
  setEditingCard(id: CanvasCardId | null): void;
  /** 编辑、新建草稿与改尺寸期间，选中描边跟随实时外框；编辑态与选中态共用同一段描边绘制。 */
  setSelectionFrame(frame: CanvasSelectionFrame | null): void;
  hasBitmap(id: CanvasCardId, key: string): boolean;
  readRasterReceipt(
    id: CanvasCardId,
    key: string
  ): {
    readonly acceptedAfterRender: number;
    readonly firstPresented: boolean;
    readonly rendered: boolean;
  } | null;
  setDragPreview(ids: readonly CanvasCardId[], dx: number, dy: number): void;
  clearDragPreview(): void;
  setBrush(rectangle: CanvasRectangle | null): void;
  setGuides(guides: readonly CanvasGuide[]): void;
  setBitmap(id: CanvasCardId, revision: number, key: string, bitmap: ImageBitmap): boolean;
  setRasterTiles(
    id: CanvasCardId,
    revision: number,
    key: string,
    tiles: readonly CanvasRasterTile[]
  ): boolean;
  setRasterContentKey(id: CanvasCardId, key: string): void;
  invalidateBitmaps(): void;
  setAppearance(appearance: CanvasAppearance): void;
  resize(width: number, height: number, resolution?: number): void;
  fit(rectangles: readonly CanvasRectangle[]): void;
  hitTest(point: CanvasPoint): CanvasCard | null;
  hitTestEdge(point: CanvasPoint): CanvasEdge | null;
  setSelectedEdge(id: CanvasEdgeId | null): void;
  setHoveredCard(id: CanvasCardId | null): void;
  setDocumentTitles(titles: ReadonlyMap<string, string>): void;
  setThumbnailCards(ids: ReadonlySet<CanvasCardId>): void;
  readEdgeGeometry(id: CanvasEdgeId): CanvasEdgeGeometry | null;
  readCard(id: CanvasCardId): CanvasCard | null;
  visibleCards(): readonly CanvasCard[];
  renderableCards(): readonly CanvasCard[];
  rasterCards(): readonly CanvasCard[];
  readVisibleCardRegions(id: CanvasCardId): readonly CanvasRectangle[];
  readMissingBitmapRegions(
    id: CanvasCardId,
    key: string,
    regions: readonly CanvasRectangle[],
    resolution: { readonly scale: number; readonly exact: boolean }
  ): readonly CanvasRectangle[];
  screenToWorld(point: CanvasPoint): CanvasPoint;
  worldToScreen(point: CanvasPoint): CanvasPoint;
  captureImage(format: 'png' | 'jpeg', quality?: number): Promise<string>;
  readStats(): CanvasSpatialProjectionStats & {
    readonly cards: number;
    readonly edges: number;
    readonly bitmaps: number;
    readonly bitmapBytes: number;
    readonly renders: number;
    readonly bitmapBudgetBytes: number;
    readonly rasterTiles: number;
    readonly fadingCards: number;
    readonly retiringBytes: number;
    readonly retiringTiles: number;
    readonly sceneTransitions: number;
    readonly cameraTransition: boolean;
    readonly viewportCards: number;
    readonly renderableCards: number;
    readonly rasterCards: number;
    readonly identityPages: number;
    readonly identityEntries: number;
    readonly identityBytes: number;
    readonly identityCanvasBytes: number;
    readonly identityPageUpdates: number;
    readonly identityActiveLabels: number;
    readonly estimatedTextureBytes: number;
    readonly textureBudgetBytes: number;
    readonly lineMeshBuilds: number;
    readonly visibleEdges: number;
  };
  destroy(): void;
}

export type CanvasInteractionKernel = Pick<
  CanvasKernel,
  | 'canvas'
  | 'readCamera'
  | 'setCamera'
  | 'screenToWorld'
  | 'hitTest'
  | 'hitTestEdge'
  | 'setHoveredCard'
  | 'visibleCards'
  | 'readSelection'
  | 'readDisplayPosition'
  | 'setBrush'
  | 'setGuides'
  | 'setDragPreview'
  | 'clearDragPreview'
>;
