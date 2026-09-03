/** 插件只获得“有序 PNG 页面 → PDF bytes”的窄能力。 */
export { renderRasterPdfDocument } from '../../features/system/export/orchestration/renderRasterPdfDocument';

export type {
  RasterPdfDocumentRequest,
} from '@linnya/plugin-host-contract/backend/pdfDocumentRuntime';
