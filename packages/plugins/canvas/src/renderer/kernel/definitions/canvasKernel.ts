import type { CanvasCamera, CanvasCard, CanvasCardId, CanvasElement, CanvasPoint, CanvasRectangle } from '../../../shared';

export type CanvasKernelIntent =
  | { readonly kind: 'select'; readonly ids: readonly CanvasCardId[]; readonly additive: boolean }
  | { readonly kind: 'move'; readonly ids: readonly CanvasCardId[]; readonly dx: number; readonly dy: number }
  | { readonly kind: 'open'; readonly id: CanvasCardId }
  | { readonly kind: 'context'; readonly point: CanvasPoint; readonly id: CanvasCardId | null }
  | { readonly kind: 'camera'; readonly camera: CanvasCamera };
export interface CanvasAppearance {
  readonly dark: boolean;
  readonly material: 'paper' | 'card';
  readonly overview: 'titles' | 'thumbnails';
}
export interface CanvasKernel {
  readonly canvas: HTMLCanvasElement;
  setElements(elements: readonly CanvasElement[]): void;
  setCamera(camera: CanvasCamera): void;
  readCamera(): CanvasCamera;
  setSelection(ids: readonly CanvasCardId[]): void;
  setBitmap(id: CanvasCardId, revision: number, key: string, bitmap: ImageBitmap): boolean;
  invalidateBitmaps(): void;
  setAppearance(appearance: CanvasAppearance): void;
  resize(width: number, height: number, resolution?: number): void;
  fit(rectangles: readonly CanvasRectangle[]): void;
  hitTest(point: CanvasPoint): CanvasCard | null;
  visibleCards(): readonly CanvasCard[];
  screenToWorld(point: CanvasPoint): CanvasPoint;
  worldToScreen(point: CanvasPoint): CanvasPoint;
  readStats(): { readonly cards: number; readonly edges: number; readonly bitmaps: number; readonly bitmapBytes: number; readonly renders: number };
  destroy(): void;
}
