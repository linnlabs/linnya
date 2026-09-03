import type { RasterPdfDocumentRequest } from '@linnya/plugin-host-contract/backend/pdfDocumentRuntime';
import { getDesktopRasterPdfDocumentPort } from '../../../../app-hosts/linnya/desktop-capabilities';
import { assertRasterPdfDocumentRequest } from '../functions/assertRasterPdfDocumentRequest';

/**
 * 插件侧只提交有序 PNG 页面与物理页面尺寸。校验留在 Backend owner；Desktop
 * capability 只负责 Chromium 打印，不取得插件 registry 或业务对象。
 */
export function renderRasterPdfDocument(
  request: RasterPdfDocumentRequest,
): Promise<Uint8Array> {
  assertRasterPdfDocumentRequest(request);
  return getDesktopRasterPdfDocumentPort().render(request);
}
