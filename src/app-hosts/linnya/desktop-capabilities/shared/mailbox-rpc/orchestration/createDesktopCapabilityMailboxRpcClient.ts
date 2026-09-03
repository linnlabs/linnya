import { randomBytes, randomUUID } from 'node:crypto';

import type { AppServerRpcPeer } from '../../../../app-server-rpc';
import {
  cleanupBackendRendererRequestMailbox,
  publishBackendRendererRequestMailbox,
  readBackendRendererResponseMailbox,
} from '../../../../adapters/backend-renderer-requests';
import {
  DESKTOP_CAPABILITY_MAILBOX_PROTOCOL_VERSION,
  type DesktopCapabilityMailboxRpcClientPort,
} from '../definitions/desktopCapabilityMailboxRpc';
import { parseDesktopCapabilityMailboxRpcResult } from '../functions/desktopCapabilityMailboxRpcCodec';

/**
 * 大值沿 AppData 私有 mailbox 传输；RPC 只携带随机 operation/token 和提交事实。
 * 底层 mailbox 目前与 Renderer request 共享实现，production cutover 后再统一物理命名。
 */
export function createDesktopCapabilityMailboxRpcClient(input: {
  readonly rpc: Pick<AppServerRpcPeer, 'request'>;
  readonly mailboxRoot: string;
  readonly createOperationId?: () => string;
  readonly createToken?: () => string;
}): DesktopCapabilityMailboxRpcClientPort {
  const createOperationId = input.createOperationId ?? randomUUID;
  const createToken = input.createToken ?? (() => randomBytes(16).toString('hex'));
  const client: DesktopCapabilityMailboxRpcClientPort = {
    async invoke(method, channel, args, options) {
      const operationId = createOperationId();
      const token = createToken();
      try {
        await publishBackendRendererRequestMailbox({
          root: input.mailboxRoot,
          operationId,
          token,
          channel,
          args,
        });
        const response = parseDesktopCapabilityMailboxRpcResult(
          await input.rpc.request(method, {
            protocol_version: DESKTOP_CAPABILITY_MAILBOX_PROTOCOL_VERSION,
            operation_id: operationId,
            token,
          }, options),
        );
        if (response.operation_id !== operationId) {
          throw new Error('Desktop capability mailbox response operation_id 不匹配');
        }
        return await readBackendRendererResponseMailbox({
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
  return Object.freeze(client);
}
