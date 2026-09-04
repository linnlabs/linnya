export const PDF_RASTER_DEFAULT_TARGET_PIXELS = 1536;
export const PDF_RASTER_MAX_TARGET_PIXELS = 1536;
export const PDF_RASTER_MIN_TARGET_PIXELS = 256;
export const PDF_RASTER_JPEG_QUALITY = 80;
export const PDF_VISION_MAX_IN_FLIGHT_PAGES = 2;

export interface RasterizedPdfPage {
  readonly pageNumber: number;
  readonly width: number;
  readonly height: number;
  readonly jpegBytes: Buffer;
  readonly renderDurationMs: number;
}

export interface PdfRasterDocument {
  readonly pageCount: number;
  renderPageToJpeg(
    pageNumber: number,
    options?: { readonly targetPixels?: number }
  ): Promise<RasterizedPdfPage>;
  close(): Promise<void>;
}

export function normalizePdfRasterTargetPixels(targetPixels: number): number {
  if (!Number.isFinite(targetPixels)) {
    throw new Error('PDF 栅格化目标尺寸必须是有限数字');
  }
  return Math.min(
    PDF_RASTER_MAX_TARGET_PIXELS,
    Math.max(PDF_RASTER_MIN_TARGET_PIXELS, Math.round(targetPixels))
  );
}
