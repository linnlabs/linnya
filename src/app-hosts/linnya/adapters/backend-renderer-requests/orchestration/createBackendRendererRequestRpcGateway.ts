import { randomBytes, randomUUID } from 'node:crypto';

import type { AppServerRpcPeer } from '../../../app-server-rpc';
import type { BackendRendererRequestRpcGatewayPort } from '../definitions/backendRendererRequestRpc';
import {
  BACKEND_RENDERER_REQUEST_INLINE_MAX_BYTES,
  BACKEND_RENDERER_REQUEST_INVOKE_RPC_METHOD,
  BACKEND_RENDERER_REQUEST_LIST_RPC_METHOD,
  BACKEND_RENDERER_REQUEST_PROTOCOL_VERSION,
  BACKEND_RENDERER_SESSION_RELEASE_RPC_METHOD,
} from '../definitions/backendRendererRequestRpc';
import {
  cleanupBackendRendererRequestMailbox,
  publishBackendRendererRequestMailbox,
  readBackendRendererResponseMailbox,
  shouldUseBackendRendererRequestMailbox,
} from '../functions/backendRendererRequestMailbox';
import {
  parseBackendRendererRequestChannelList,
  parseBackendRendererRequestRpcResponse,
} from '../functions/backendRendererRequestRpcCodec';
import {
  decodeBackendRendererRequestValue,
  encodeBackendRendererRequestValue,
} from '../functions/backendRendererRequestValueCodec';

export function createBackendRendererRequestRpcGateway(input: {
  readonly rpc: Pick<AppServerRpcPeer, 'request'>;
  readonly mailboxRoot: string;
  readonly createOperationId?: () => string;
  readonly createToken?: () => string;
}): BackendRendererRequestRpcGatewayPort {
  const createOperationId = input.createOperationId ?? randomUUID;
  const createToken = input.createToken ?? (() => randomBytes(16).toString('hex'));
  const gateway: BackendRendererRequestRpcGatewayPort = {
    async releaseRendererSession(rendererSessionId) {
      await input.rpc.request(BACKEND_RENDERER_SESSION_RELEASE_RPC_METHOD, rendererSessionId);
    },
    async listChannels() {
      return parseBackendRendererRequestChannelList(
        await input.rpc.request(BACKEND_RENDERER_REQUEST_LIST_RPC_METHOD, null),
      );
    },
    async invoke(channel, args, options) {
      const operationId = createOperationId();
      const token = createToken();
      let inlineValues = shouldUseBackendRendererRequestMailbox(args)
        ? null
        : args.map(encodeBackendRendererRequestValue);
      if (inlineValues
        && Buffer.byteLength(JSON.stringify(inlineValues), 'utf8') > BACKEND_RENDERER_REQUEST_INLINE_MAX_BYTES) {
        inlineValues = null;
      }
      try {
        if (!inlineValues) {
          await publishBackendRendererRequestMailbox({
            root: input.mailboxRoot,
            operationId,
            token,
            channel,
            args,
          });
        }
        options?.signal?.throwIfAborted();
        const rawResponse = await input.rpc.request(
          BACKEND_RENDERER_REQUEST_INVOKE_RPC_METHOD,
          {
            protocol_version: BACKEND_RENDERER_REQUEST_PROTOCOL_VERSION,
            operation_id: operationId,
            token,
            channel,
            renderer_session_id: options?.rendererSessionId ?? null,
            args: inlineValues
              ? { kind: 'inline', values: inlineValues }
              : { kind: 'mailbox' },
          },
          options,
        );
        const response = parseBackendRendererRequestRpcResponse(rawResponse);
        if (response.operation_id !== operationId) {
          throw new Error('Backend Renderer response operation_id 不匹配');
        }
        return response.result.kind === 'inline'
          ? decodeBackendRendererRequestValue(response.result.value)
          : await readBackendRendererResponseMailbox({
            root: input.mailboxRoot,
            operationId,
            token,
          });
      } finally {
        await cleanupBackendRendererRequestMailbox({
          root: input.mailboxRoot,
          operationId,
        });
      }
    },
  };
  return Object.freeze(gateway);
}
