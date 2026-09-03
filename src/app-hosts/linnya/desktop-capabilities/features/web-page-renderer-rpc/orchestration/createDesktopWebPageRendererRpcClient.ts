import type { WebPageRenderer } from '../../../../../../tools/web/webread/definitions/webPageRenderer';
import { WebPageRenderError } from '../../../../../../tools/web/webread/definitions/webPageRenderer';
import type { DesktopCapabilityMailboxRpcClientPort } from '../../../shared/mailbox-rpc/definitions/desktopCapabilityMailboxRpc';
import {
  DESKTOP_WEB_PAGE_RENDER_MAILBOX_CHANNEL,
  DESKTOP_WEB_PAGE_RENDER_RPC_METHOD,
} from '../definitions/webPageRendererRpc';
import {
  WebPageRenderRpcRequestSchema,
  WebPageRenderRpcResultSchema,
} from '../functions/webPageRendererRpcCodec';

/** Backend 继续只依赖 WebPageRenderer；RPC method 与 mailbox 对业务 provider 不可见。 */
export function createDesktopWebPageRendererRpcClient(
  mailbox: DesktopCapabilityMailboxRpcClientPort,
): WebPageRenderer {
  const renderer: WebPageRenderer = {
    async render(params) {
      const request = WebPageRenderRpcRequestSchema.parse({
        url: params.url,
        timeout_ms: params.timeoutMs,
      });
      let rawResult: unknown;
      try {
        rawResult = await mailbox.invoke(
          DESKTOP_WEB_PAGE_RENDER_RPC_METHOD,
          DESKTOP_WEB_PAGE_RENDER_MAILBOX_CHANNEL,
          [request],
          params.signal ? { signal: params.signal } : undefined,
        );
      } catch (error: unknown) {
        if (params.signal?.aborted) {
          throw new WebPageRenderError('aborted', '网页渲染已由调用方取消。');
        }
        throw error;
      }
      const result = WebPageRenderRpcResultSchema.parse(rawResult);
      if (!result.ok) {
        throw new WebPageRenderError(result.error.kind, result.error.message);
      }
      return {
        html: result.value.html,
        finalUrl: result.value.final_url,
      };
    },
  };
  return Object.freeze(renderer);
}
