import type { RasterPdfDocumentRequest } from '@linnya/plugin-host-contract/backend/pdfDocumentRuntime';

/**
 * Backend 把已校验的栅格页面交给 Desktop Chromium 打印能力。
 *
 * 这里只暴露页面 bytes 与物理尺寸，不接受 HTML、BrowserWindow 参数或文件路径。
 */
export interface DesktopRasterPdfDocumentPort {
  render(request: RasterPdfDocumentRequest): Promise<Uint8Array>;
}
