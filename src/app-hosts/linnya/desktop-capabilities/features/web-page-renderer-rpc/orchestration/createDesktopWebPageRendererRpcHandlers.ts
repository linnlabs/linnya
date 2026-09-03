import type {
  AppServerRpcHandler,
  AppServerRpcHandlerRegistry,
} from '../../../../app-server-rpc';
import type { WebPageRenderer } from '../../../../../../tools/web/webread/definitions/webPageRenderer';
import { WebPageRenderError } from '../../../../../../tools/web/webread/definitions/webPageRenderer';
import { createDesktopCapabilityMailboxRpcHandler } from '../../../shared/mailbox-rpc/orchestration/createDesktopCapabilityMailboxRpcHandler';
import {
  DESKTOP_WEB_PAGE_RENDER_MAILBOX_CHANNEL,
  DESKTOP_WEB_PAGE_RENDER_RPC_METHOD,
} from '../definitions/webPageRendererRpc';
import {
  WebPageRenderRpcRequestSchema,
  WebPageRenderRpcResultSchema,
} from '../functions/webPageRendererRpcCodec';

export function createDesktopWebPageRendererRpcHandlers(input: {
  readonly port: WebPageRenderer;
  readonly mailboxRoot: string;
}): AppServerRpcHandlerRegistry {
  const render = createDesktopCapabilityMailboxRpcHandler({
    mailboxRoot: input.mailboxRoot,
    channel: DESKTOP_WEB_PAGE_RENDER_MAILBOX_CHANNEL,
    async invoke(args, context) {
      if (args.length !== 1) throw new Error('Web page render 参数数量不合法');
      const request = WebPageRenderRpcRequestSchema.parse(args[0]);
      try {
        const result = await input.port.render({
          url: request.url,
          signal: context.signal,
          timeoutMs: request.timeout_ms,
        });
        return WebPageRenderRpcResultSchema.parse({
          ok: true,
          value: { html: result.html, final_url: result.finalUrl },
        });
      } catch (error: unknown) {
        const failure = error instanceof WebPageRenderError
          ? error
          : new WebPageRenderError(
            context.signal.aborted ? 'aborted' : 'render_failed',
            error instanceof Error ? error.message : String(error),
          );
        return WebPageRenderRpcResultSchema.parse({
          ok: false,
          error: { kind: failure.kind, message: failure.message.slice(0, 2_048) },
        });
      }
    },
  });
  return new Map<string, AppServerRpcHandler>([
    [DESKTOP_WEB_PAGE_RENDER_RPC_METHOD, render],
  ]);
}

