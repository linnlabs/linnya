import type {
  AppServerRpcHandler,
  AppServerRpcHandlerRegistry,
} from '../../../../app-server-rpc';
import type { DesktopRasterPdfDocumentPort } from '../../../definitions/desktopRasterPdfDocumentPort';
import { createDesktopCapabilityMailboxRpcHandler } from '../../../shared/mailbox-rpc/orchestration/createDesktopCapabilityMailboxRpcHandler';
import { assertRasterPdfDocumentRequest } from '../../../../../../features/system/export/functions/assertRasterPdfDocumentRequest';
import {
  DESKTOP_RASTER_PDF_RENDER_MAILBOX_CHANNEL,
  DESKTOP_RASTER_PDF_RENDER_RPC_METHOD,
} from '../definitions/rasterPdfDocumentRpc';

export function createDesktopRasterPdfDocumentRpcHandlers(input: {
  readonly port: DesktopRasterPdfDocumentPort;
  readonly mailboxRoot: string;
}): AppServerRpcHandlerRegistry {
  const render = createDesktopCapabilityMailboxRpcHandler({
    mailboxRoot: input.mailboxRoot,
    channel: DESKTOP_RASTER_PDF_RENDER_MAILBOX_CHANNEL,
    invoke: async args => {
      if (args.length !== 1) throw new Error('Raster PDF 参数数量不合法');
      const request = args[0];
      assertRasterPdfDocumentRequest(request);
      const result = await input.port.render(request);
      if (!(result instanceof Uint8Array) || result.byteLength === 0) {
        throw new Error('Desktop raster PDF runtime 返回空结果');
      }
      return result;
    },
  });
  return new Map<string, AppServerRpcHandler>([
    [DESKTOP_RASTER_PDF_RENDER_RPC_METHOD, render],
  ]);
}
