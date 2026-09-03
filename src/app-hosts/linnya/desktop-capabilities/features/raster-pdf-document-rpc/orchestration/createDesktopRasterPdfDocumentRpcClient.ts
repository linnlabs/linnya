import type { DesktopRasterPdfDocumentPort } from '../../../definitions/desktopRasterPdfDocumentPort';
import type { DesktopCapabilityMailboxRpcClientPort } from '../../../shared/mailbox-rpc/definitions/desktopCapabilityMailboxRpc';
import { assertRasterPdfDocumentRequest } from '../../../../../../features/system/export/functions/assertRasterPdfDocumentRequest';
import {
  DESKTOP_RASTER_PDF_RENDER_MAILBOX_CHANNEL,
  DESKTOP_RASTER_PDF_RENDER_RPC_METHOD,
} from '../definitions/rasterPdfDocumentRpc';

export function createDesktopRasterPdfDocumentRpcClient(
  mailbox: DesktopCapabilityMailboxRpcClientPort,
): DesktopRasterPdfDocumentPort {
  const port: DesktopRasterPdfDocumentPort = {
    async render(request) {
      assertRasterPdfDocumentRequest(request);
      const result = await mailbox.invoke(
        DESKTOP_RASTER_PDF_RENDER_RPC_METHOD,
        DESKTOP_RASTER_PDF_RENDER_MAILBOX_CHANNEL,
        [request],
      );
      if (!(result instanceof Uint8Array) || result.byteLength === 0) {
        throw new Error('Desktop raster PDF response 不是非空 bytes');
      }
      return result;
    },
  };
  return Object.freeze(port);
}
