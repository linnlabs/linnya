export interface CardRasterKey {
  readonly revision: number;
  readonly theme: string;
  readonly dpr: number;
  readonly material: string;
  readonly lod: number;
  readonly font: string;
  readonly uiScale: number;
}
export interface CardRasterRequest {
  readonly element: HTMLElement;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  /** width 保持完整正文排版宽度；tileWidth 只限制当前可见纹理。 */
  readonly tileWidth?: number;
  readonly offsetX?: number;
  readonly offsetY?: number;
}
export interface CardRasterResult {
  readonly bitmap: ImageBitmap;
  readonly width: number;
  readonly height: number;
  readonly contentHeight: number;
}
export interface CardRasterizer {
  measure(element: HTMLElement, width: number, signal?: AbortSignal): Promise<number>;
  rasterize(request: CardRasterRequest, signal?: AbortSignal): Promise<CardRasterResult>;
  dispose(): void;
}
export type RasterQueueResult<T> =
  | { readonly status: 'ready'; readonly value: T }
  | { readonly status: 'superseded' | 'cancelled' | 'dropped' }
  | { readonly status: 'failed'; readonly error: unknown };
