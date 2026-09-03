import type { BrushArtworkIntent } from './brushArtworkAuthoring';

export {
  BRUSH_ARTWORK_BRUSHES,
  BRUSH_ARTWORK_FIELDS,
  BRUSH_ARTWORK_LIMITS,
  BRUSH_ARTWORK_QUALITIES,
} from './brushArtworkAuthoring';
export type {
  BrushArtworkArcMark,
  BrushArtworkBrush,
  BrushArtworkEllipseMark,
  BrushArtworkField,
  BrushArtworkFill,
  BrushArtworkFlowLineMark,
  BrushArtworkHatch,
  BrushArtworkIntent,
  BrushArtworkLayer,
  BrushArtworkLineMark,
  BrushArtworkMark,
  BrushArtworkMassFill,
  BrushArtworkPoint,
  BrushArtworkPolygonMark,
  BrushArtworkPosition,
  BrushArtworkQuality,
  BrushArtworkRectMark,
  BrushArtworkSplineMark,
  BrushArtworkSourceRef,
  BrushArtworkStroke,
  BrushArtworkWashFill,
  BrushArtworkWatercolorFill,
} from './brushArtworkAuthoring';

export interface BrushArtworkPixelSize {
  readonly widthPx: number;
  readonly heightPx: number;
}

export interface BrushArtworkRenderRequest extends BrushArtworkPixelSize {
  readonly requestId: string;
  readonly intent: BrushArtworkIntent;
}

export type BrushArtworkRenderErrorCode =
  | 'slides.brush.invalid_request'
  | 'slides.brush.runtime_unavailable'
  | 'slides.brush.render_failed'
  | 'slides.brush.encode_failed';

export interface BrushArtworkRenderSuccess extends BrushArtworkPixelSize {
  readonly status: 'success';
  readonly requestId: string;
  readonly bytes: Uint8Array;
}

export interface BrushArtworkRenderFailure {
  readonly status: 'failure';
  readonly requestId: string;
  readonly error: {
    readonly code: BrushArtworkRenderErrorCode;
    readonly message: string;
  };
}

export type BrushArtworkRenderResult =
  | BrushArtworkRenderSuccess
  | BrushArtworkRenderFailure;
