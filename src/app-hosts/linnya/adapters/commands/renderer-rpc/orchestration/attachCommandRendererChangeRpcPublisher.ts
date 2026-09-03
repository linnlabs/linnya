import type { AppServerRpcPeer } from 'src/app-hosts/linnya/app-server-rpc';
import type { CommandApprovalRendererPagePort } from '../../approval-host';
import type { CommandCardRendererControlPort } from '../../command-card-control-host';
import {
  DESKTOP_COMMAND_APPROVAL_CHANGED_RPC_METHOD,
  DESKTOP_COMMAND_CARD_CHANGED_RPC_METHOD,
} from '../definitions/commandRendererRpc';
import { CommandVoidRpcResponseSchema } from '../functions/commandRendererRpcCodec';

export interface CommandRendererChangeRpcPublisher {
  dispose(): void;
}

/** 高频卡片变化最多保留一个 in-flight 与一个 dirty bit，不会扩张 RPC pending 队列。 */
export function attachCommandRendererChangeRpcPublisher(input: {
  readonly rpc: Pick<AppServerRpcPeer, 'request'>;
  readonly approval: Pick<CommandApprovalRendererPagePort, 'subscribe'>;
  readonly card: Pick<CommandCardRendererControlPort, 'subscribe'>;
  readonly onFailure: (error: Error) => void;
}): CommandRendererChangeRpcPublisher {
  let disposed = false;
  const createPublisher = (method: string) => {
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
          const response = await input.rpc.request(method, null, { timeoutMs: 5_000 });
          CommandVoidRpcResponseSchema.parse(response);
        }
      })().catch((error: unknown) => {
        if (!disposed) input.onFailure(toError(error));
      }).finally(() => {
        publishing = false;
        if (!disposed && dirty) publish();
      });
    };
    return publish;
  };

  const unsubscribeApproval = input.approval.subscribe(createPublisher(
    DESKTOP_COMMAND_APPROVAL_CHANGED_RPC_METHOD,
  ));
  const unsubscribeCard = input.card.subscribe(createPublisher(
    DESKTOP_COMMAND_CARD_CHANGED_RPC_METHOD,
  ));

  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeApproval();
      unsubscribeCard();
    },
  });
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
