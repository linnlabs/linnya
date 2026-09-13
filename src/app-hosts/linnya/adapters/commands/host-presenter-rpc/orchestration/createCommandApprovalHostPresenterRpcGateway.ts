import type {
  AppServerRpcHandler,
  AppServerRpcHandlerRegistry,
  AppServerRpcPeer,
} from '../../../../app-server-rpc';
import type { CommandApprovalHostPresenterGatewayPort } from '../../approval-host';
import {
  BACKEND_COMMAND_APPROVAL_HOST_READ_RPC_METHOD,
  BACKEND_COMMAND_APPROVAL_HOST_REPLY_RPC_METHOD,
  HOST_COMMAND_APPROVAL_CHANGED_RPC_METHOD,
} from '../definitions/commandApprovalHostPresenterRpc';
import {
  CommandApprovalHostPresenterChangedPayloadSchema,
  CommandApprovalHostPresenterReadResponseSchema,
  CommandApprovalHostPresenterReplyResponseSchema,
} from '../functions/commandApprovalHostPresenterRpcCodec';

export function createCommandApprovalHostPresenterRpcGateway(input: {
  readonly rpc: Pick<AppServerRpcPeer, 'request'>;
}): {
  readonly gateway: CommandApprovalHostPresenterGatewayPort;
  readonly notificationHandlers: AppServerRpcHandlerRegistry;
} {
  const listeners = new Set<() => void>();
  const notificationHandlers = new Map<string, AppServerRpcHandler>([
    [HOST_COMMAND_APPROVAL_CHANGED_RPC_METHOD, payload => {
      CommandApprovalHostPresenterChangedPayloadSchema.parse(payload);
      for (const listener of listeners) listener();
      return null;
    }],
  ]);
  const gateway: CommandApprovalHostPresenterGatewayPort = {
    async read() {
      const response = await input.rpc.request(
        BACKEND_COMMAND_APPROVAL_HOST_READ_RPC_METHOD,
        null,
      );
      const parsed = CommandApprovalHostPresenterReadResponseSchema.parse(response);
      return parsed ? { pending: parsed.pending } : undefined;
    },
    async submit(request) {
      const response = await input.rpc.request(
        BACKEND_COMMAND_APPROVAL_HOST_REPLY_RPC_METHOD,
        {
          approval_request_id: request.approvalRequestId,
          choice: request.choice,
        },
      );
      return CommandApprovalHostPresenterReplyResponseSchema.parse(response);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return Object.freeze({ gateway: Object.freeze(gateway), notificationHandlers });
}
