import type { RasterPdfDocumentRequest } from '@linnya/plugin-host-contract/backend/pdfDocumentRuntime';
import { ExportArtifactRequestInvalidError } from '../definitions/exportErrors';

/** Backend facade 与 Desktop reverse-capability adapter 共用同一份 raster 入站规则。 */
export function assertRasterPdfDocumentRequest(
  request: unknown,
): asserts request is RasterPdfDocumentRequest {
  if (
    typeof request !== 'object'
    || request === null
    || !('pageWidthInches' in request)
    || typeof request.pageWidthInches !== 'number'
    || !('pageHeightInches' in request)
    || typeof request.pageHeightInches !== 'number'
    || !('pages' in request)
    || !Number.isFinite(request.pageWidthInches)
    || request.pageWidthInches <= 0
    || !Number.isFinite(request.pageHeightInches)
    || request.pageHeightInches <= 0
    || !Array.isArray(request.pages)
    || request.pages.length === 0
    || request.pages.some(page => !(page instanceof Uint8Array) || page.byteLength === 0)
  ) {
    throw new ExportArtifactRequestInvalidError('rasterPdfDocument');
  }
}
