export interface RasterPdfDocumentRequest {
  readonly pageWidthInches: number;
  readonly pageHeightInches: number;
  readonly pages: readonly Uint8Array[];
}

/** 插件只能封装已经栅格化的页面，不能控制 BrowserWindow、HTML 或打印参数。 */
export declare function renderRasterPdfDocument(
  request: RasterPdfDocumentRequest,
): Promise<Uint8Array>;
