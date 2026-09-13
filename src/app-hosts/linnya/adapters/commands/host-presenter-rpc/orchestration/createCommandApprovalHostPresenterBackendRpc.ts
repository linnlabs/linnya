import type {
  AppServerRpcHandler,
  AppServerRpcHandlerRegistry,
  AppServerRpcPeer,
} from '../../../../app-server-rpc';
import type { CommandApprovalHostPresenterPort } from '../../approval-host';
import {
  BACKEND_COMMAND_APPROVAL_HOST_READ_RPC_METHOD,
  BACKEND_COMMAND_APPROVAL_HOST_REPLY_RPC_METHOD,
  HOST_COMMAND_APPROVAL_CHANGED_RPC_METHOD,
} from '../definitions/commandApprovalHostPresenterRpc';
import {
  CommandApprovalHostPresenterSnapshotSchema,
  CommandApprovalHostPresenterReplyRequestSchema,
  CommandApprovalHostPresenterVoidResponseSchema,
} from '../functions/commandApprovalHostPresenterRpcCodec';

export function createCommandApprovalHostPresenterBackendRpcHandlers(
  approval: CommandApprovalHostPresenterPort,
): AppServerRpcHandlerRegistry {
  return new Map<string, AppServerRpcHandler>([
    [BACKEND_COMMAND_APPROVAL_HOST_READ_RPC_METHOD, () => {
      const snapshot = approval.readHostPresenter();
      return snapshot
        ? CommandApprovalHostPresenterSnapshotSchema.parse({
            protocol_version: 1,
            kind: 'command_approval_host_presenter_snapshot',
            pending: [...snapshot.pending],
          })
        : null;
    }],
    [BACKEND_COMMAND_APPROVAL_HOST_REPLY_RPC_METHOD, payload => {
      const request = CommandApprovalHostPresenterReplyRequestSchema.parse(payload);
      return approval.submitHostReply({
        approvalRequestId: request.approval_request_id,
        choice: request.choice,
      });
    }],
  ]);
}

export interface CommandApprovalHostPresenterPublisher {
  dispose(): void;
}

/** 通知只表示 snapshot 已脏；高频变化合并，不把 pending 事实复制进通知队列。 */
export function attachCommandApprovalHostPresenterPublisher(input: {
  readonly rpc: Pick<AppServerRpcPeer, 'request'>;
  readonly approval: Pick<CommandApprovalHostPresenterPort, 'subscribe'>;
  readonly onFailure: (error: Error) => void;
}): CommandApprovalHostPresenterPublisher {
  let disposed = false;
  let dirty = false;
  let publishing = false;
  const publish = (): void => {
    if (disposed) return;
    dirty = true;
    if (publishing) return;
    publishing = true;
    void (async () => {
      while (!disposed && dirty) {
        dirty = false;
        const response = await input.rpc.request(
          HOST_COMMAND_APPROVAL_CHANGED_RPC_METHOD,
          null,
          { timeoutMs: 5_000 },
        );
        CommandApprovalHostPresenterVoidResponseSchema.parse(response);
      }
    })().catch((error: unknown) => {
      if (!disposed) input.onFailure(toError(error));
    }).finally(() => {
      publishing = false;
      if (!disposed && dirty) publish();
    });
  };
  const unsubscribe = input.approval.subscribe(publish);
  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
    },
  });
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
