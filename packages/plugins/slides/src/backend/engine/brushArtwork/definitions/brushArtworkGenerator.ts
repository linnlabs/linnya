import type {
  BrushArtworkIntent,
  BrushArtworkPixelSize,
  BrushArtworkRenderRequest,
} from '@plugin/slides/shared';

export const BRUSH_ARTWORK_UPSTREAM_COMMIT = 'fc37da3da3fa07e58edf880fb2788c5529a51ebe';
export const BRUSH_ARTWORK_ADAPTER_VERSION = 'v2';

export interface BrushArtworkGeneratedAsset extends BrushArtworkPixelSize {
  readonly bytes: Uint8Array;
}

/** Engine 只依赖“把自包含请求变成 PNG”这一能力，不知道 WebGL 或 Electron。 */
export interface BrushArtworkGeneratorPort {
  generateBrushArtwork(request: BrushArtworkRenderRequest): Promise<BrushArtworkGeneratedAsset>;
}

export interface BrushArtworkMaterializationIdentityInput extends BrushArtworkPixelSize {
  readonly intent: BrushArtworkIntent;
}
