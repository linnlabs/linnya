import type { CanvasCamera, CanvasCard, CanvasCardId, CanvasEdge, CanvasEdgeId, CanvasElement, CanvasPoint, CanvasRectangle } from '../../../shared';
import type { CanvasEdgeGeometry } from '../geometry/canvasEdgeGeometry';

export type CanvasKernelIntent =
  | { readonly kind: 'select'; readonly ids: readonly CanvasCardId[]; readonly additive: boolean }
  | { readonly kind: 'select-edge'; readonly id: CanvasEdgeId | null }
  | { readonly kind: 'move'; readonly ids: readonly CanvasCardId[]; readonly dx: number; readonly dy: number; readonly copy?: boolean }
  | { readonly kind: 'editing'; readonly ids: readonly CanvasCardId[]; readonly active: boolean }
  | { readonly kind: 'open'; readonly id: CanvasCardId }
  | { readonly kind: 'context'; readonly point: CanvasPoint; readonly id: CanvasCardId | null }
  | { readonly kind: 'camera'; readonly camera: CanvasCamera }
  | ({ readonly kind: 'render-status' } & CanvasRenderStatus);
export interface CanvasRenderStatus {
  readonly limited: boolean;
  readonly phase: 'ready' | 'restoring';
  readonly message: string | null;
}
export interface CanvasAppearance {
  readonly dark: boolean;
  readonly material: 'paper' | 'card';
  readonly overview: 'titles' | 'thumbnails';
}
export interface CanvasRasterTile {
  readonly bitmap: ImageBitmap; readonly x: number; readonly y: number; readonly width: number; readonly height: number;
}
export interface CanvasKernel {
  readonly canvas: HTMLCanvasElement;
  setElements(elements: readonly CanvasElement[]): void;
  setCamera(camera: CanvasCamera): void;
  readCamera(): CanvasCamera;
  readRenderStatus(): CanvasRenderStatus;
  readResolution(): number;
  setSelection(ids: readonly CanvasCardId[]): void;
  readSelection(): readonly CanvasCardId[];
  setEditingCard(id: CanvasCardId | null): void;
  hasBitmap(id: CanvasCardId, key: string): boolean;
  setDragPreview(ids: readonly CanvasCardId[], dx: number, dy: number): void;
  clearDragPreview(): void;
  setBrush(rectangle: CanvasRectangle | null): void;
  setBitmap(id: CanvasCardId, revision: number, key: string, bitmap: ImageBitmap): boolean;
  setRasterTiles(id: CanvasCardId, revision: number, key: string, tiles: readonly CanvasRasterTile[]): boolean;
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
  visibleCards(): readonly CanvasCard[];
  renderableCards(): readonly CanvasCard[];
  rasterCards(): readonly CanvasCard[];
  readVisibleCardRegions(id: CanvasCardId): readonly CanvasRectangle[];
  readMissingBitmapRegions(id: CanvasCardId, key: string, regions: readonly CanvasRectangle[]): readonly CanvasRectangle[];
  screenToWorld(point: CanvasPoint): CanvasPoint;
  worldToScreen(point: CanvasPoint): CanvasPoint;
  captureImage(format: 'png' | 'jpeg', quality?: number): Promise<string>;
  readStats(): { readonly cards: number; readonly edges: number; readonly bitmaps: number; readonly bitmapBytes: number; readonly renders: number;
    readonly lineMeshBuilds: number; readonly visibleEdges: number };
  destroy(): void;
}

export type CanvasInteractionKernel = Pick<CanvasKernel,
  'canvas' | 'readCamera' | 'setCamera' | 'screenToWorld' | 'hitTest' | 'hitTestEdge' | 'setHoveredCard' | 'visibleCards' | 'readSelection' | 'setBrush' | 'setDragPreview' | 'clearDragPreview'>;
