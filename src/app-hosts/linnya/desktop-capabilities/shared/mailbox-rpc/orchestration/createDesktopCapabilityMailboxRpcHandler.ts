import type { JsonValue } from '@app/schemas';

import type {
  AppServerRpcHandler,
  AppServerRpcHandlerContext,
} from '../../../../app-server-rpc';
import {
  publishBackendRendererResponseMailbox,
  readBackendRendererRequestMailbox,
} from '../../../../adapters/backend-renderer-requests';
import { DESKTOP_CAPABILITY_MAILBOX_PROTOCOL_VERSION } from '../definitions/desktopCapabilityMailboxRpc';
import { parseDesktopCapabilityMailboxRpcReference } from '../functions/desktopCapabilityMailboxRpcCodec';

export function createDesktopCapabilityMailboxRpcHandler(input: {
  readonly mailboxRoot: string;
  readonly channel: string;
  readonly invoke: (
    args: readonly unknown[],
    context: AppServerRpcHandlerContext,
  ) => unknown | Promise<unknown>;
}): AppServerRpcHandler {
  return async (payload, context) => {
    const request = parseDesktopCapabilityMailboxRpcReference(payload);
    const args = await readBackendRendererRequestMailbox({
      root: input.mailboxRoot,
      operationId: request.operation_id,
      token: request.token,
      expectedChannel: input.channel,
    });
    context.signal.throwIfAborted();
    const result = await input.invoke(args, context);
    // caller 取消后会立即清理 operation 目录；此时禁止迟到的 handler 重新创建 response mailbox。
    context.signal.throwIfAborted();
    await publishBackendRendererResponseMailbox({
      root: input.mailboxRoot,
      operationId: request.operation_id,
      token: request.token,
      result,
    });
    const response: JsonValue = {
      protocol_version: DESKTOP_CAPABILITY_MAILBOX_PROTOCOL_VERSION,
      operation_id: request.operation_id,
    };
    return response;
  };
}
