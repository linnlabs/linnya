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
} from '../definitions/backendRendererRequestRpc';
import {
  publishBackendRendererResponseMailbox,
  readBackendRendererRequestMailbox,
  shouldUseBackendRendererRequestMailbox,
} from '../functions/backendRendererRequestMailbox';
import {
  parseBackendRendererRequestRpcRequest,
} from '../functions/backendRendererRequestRpcCodec';
import {
  decodeBackendRendererRequestValue,
  encodeBackendRendererRequestValue,
} from '../functions/backendRendererRequestValueCodec';

export function createBackendRendererRequestRpcHandlers(input: {
  readonly registry: BackendRendererRequestRegistryPort;
  readonly mailboxRoot: string;
}): AppServerRpcHandlerRegistry {
  return new Map<string, AppServerRpcHandler>([
    [BACKEND_RENDERER_REQUEST_LIST_RPC_METHOD, () => [...input.registry.listChannels()]],
    [BACKEND_RENDERER_REQUEST_INVOKE_RPC_METHOD, async payload => {
      const request = parseBackendRendererRequestRpcRequest(payload);
      const args = request.args.kind === 'inline'
        ? request.args.values.map(decodeBackendRendererRequestValue)
        : await readBackendRendererRequestMailbox({
          root: input.mailboxRoot,
          operationId: request.operation_id,
          token: request.token,
          expectedChannel: request.channel,
        });
      const result = await input.registry.invoke(request.channel, args);
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
