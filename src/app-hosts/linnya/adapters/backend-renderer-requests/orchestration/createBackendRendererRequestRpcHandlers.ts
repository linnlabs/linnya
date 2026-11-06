import type { JsonValue } from '@app/schemas';

import type {
  AppServerRpcHandler,
  AppServerRpcHandlerRegistry,
} from '../../../app-server-rpc';
import type { BackendRendererRequestRegistryPort } from '../definitions/backendRendererRequest';
import {
  BACKEND_RENDERER_REQUEST_INLINE_MAX_BYTES,
  BACKEND_RENDERER_REQUEST_INVOKE_RPC_METHOD,
  BACKEND_RENDERER_REQUEST_LIST_RPC_METHOD,
  BACKEND_RENDERER_REQUEST_PROTOCOL_VERSION,
  BACKEND_RENDERER_SESSION_RELEASE_RPC_METHOD,
} from '../definitions/backendRendererRequestRpc';
import {
  publishBackendRendererResponseMailbox,
  readBackendRendererRequestMailbox,
  shouldUseBackendRendererRequestMailbox,
} from '../functions/backendRendererRequestMailbox';
import {
  parseBackendRendererRequestRpcRequest,
  parseBackendRendererRequestOperationId,
} from '../functions/backendRendererRequestRpcCodec';
import {
  decodeBackendRendererRequestValue,
  encodeBackendRendererRequestValue,
} from '../functions/backendRendererRequestValueCodec';

export function createBackendRendererRequestRpcHandlers(input: {
  readonly registry: BackendRendererRequestRegistryPort;
  readonly mailboxRoot: string;
}): AppServerRpcHandlerRegistry {
  const sessions = new Map<string, AbortController>();
  function contextFor(id: string | null) {
    if (id === null) return undefined;
    let controller = sessions.get(id);
    if (!controller) { controller = new AbortController(); sessions.set(id, controller); }
    return { rendererSessionId: id, signal: controller.signal };
  }
  return new Map<string, AppServerRpcHandler>([
    [BACKEND_RENDERER_REQUEST_LIST_RPC_METHOD, () => [...input.registry.listChannels()]],
    [BACKEND_RENDERER_SESSION_RELEASE_RPC_METHOD, payload => {
      const id = parseBackendRendererRequestOperationId(payload);
      sessions.get(id)?.abort(new Error('renderer_session_closed'));
      sessions.delete(id);
      return null;
    }],
    [BACKEND_RENDERER_REQUEST_INVOKE_RPC_METHOD, async payload => {
      const request = parseBackendRendererRequestRpcRequest(payload);
      // 在第一次 await 前登记；加载大 mailbox 途中关闭窗口也能取消同一上下文。
      const context = contextFor(request.renderer_session_id);
      const args = request.args.kind === 'inline'
        ? request.args.values.map(decodeBackendRendererRequestValue)
        : await readBackendRendererRequestMailbox({
          root: input.mailboxRoot,
          operationId: request.operation_id,
          token: request.token,
          expectedChannel: request.channel,
        });
      const result = await input.registry.invoke(request.channel, args, context);
      if (!shouldUseBackendRendererRequestMailbox([result])) {
        const encoded = encodeBackendRendererRequestValue(result);
        if (Buffer.byteLength(JSON.stringify(encoded), 'utf8') <= BACKEND_RENDERER_REQUEST_INLINE_MAX_BYTES) {
          return {
            protocol_version: BACKEND_RENDERER_REQUEST_PROTOCOL_VERSION,
            operation_id: request.operation_id,
            result: { kind: 'inline', value: encoded },
          };
        }
      }
      await publishBackendRendererResponseMailbox({
        root: input.mailboxRoot,
        operationId: request.operation_id,
        token: request.token,
        result,
      });
      const response: JsonValue = {
        protocol_version: BACKEND_RENDERER_REQUEST_PROTOCOL_VERSION,
        operation_id: request.operation_id,
        result: { kind: 'mailbox' },
      };
      return response;
    }],
  ]);
}
