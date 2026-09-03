import type {
  RenderSlideSize,
  SlideRenderModel,
} from '../../renderModel';

/** Phase 6 首版只允许无损 PNG，避免不同调用方静默改变截图像素。 */
export const SLIDE_RASTER_FORMAT = 'png' as const;

export type SlideRasterFormat = typeof SLIDE_RASTER_FORMAT;

export interface SlideRasterProfile {
  id: string;
  viewportWidthPx: number;
  viewportHeightPx: number;
  pixelRatio: number;
  format: SlideRasterFormat;
  /** SVG fallback 等原子媒体栅格不绘制页面背景，保留 alpha。 */
  transparentBackground?: boolean;
}

/** worker 只接收单页 render model，不查询 presentation 或 workspace。 */
export interface SlideRasterRequest {
  requestId: string;
  slide: SlideRenderModel;
  slideSize: RenderSlideSize;
  profile: SlideRasterProfile;
}

export interface SlideRasterPixelSize {
  widthPx: number;
  heightPx: number;
}

export type SlideRasterErrorCode =
  | 'slides.raster.invalid_request'
  | 'slides.raster.resource_load_failed'
  | 'slides.raster.render_failed'
  | 'slides.raster.encode_failed';

export interface SlideRasterSuccess {
  status: 'success';
  requestId: string;
  format: SlideRasterFormat;
  widthPx: number;
  heightPx: number;
  bytes: Uint8Array;
}

export interface SlideRasterFailure {
  status: 'failure';
  requestId: string;
  error: {
    code: SlideRasterErrorCode;
    message: string;
  };
}

export type SlideRasterResult = SlideRasterSuccess | SlideRasterFailure;
