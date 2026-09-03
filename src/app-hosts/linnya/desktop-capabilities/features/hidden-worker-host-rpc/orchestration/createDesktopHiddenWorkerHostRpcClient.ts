import type { AppServerRpcPeer } from '../../../../app-server-rpc';
import type { DesktopHiddenWorkerHostPort } from '../../../definitions/desktopHiddenWorkerHostPort';
import type { DesktopCapabilityMailboxRpcClientPort } from '../../../shared/mailbox-rpc/definitions/desktopCapabilityMailboxRpc';
import {
  DESKTOP_HIDDEN_WORKER_ENSURE_READY_RPC_METHOD,
  DESKTOP_HIDDEN_WORKER_INVALIDATE_RPC_METHOD,
  DESKTOP_HIDDEN_WORKER_INVOKE_MAILBOX_CHANNEL,
  DESKTOP_HIDDEN_WORKER_INVOKE_RPC_METHOD,
  DESKTOP_HIDDEN_WORKER_READY_MAILBOX_CHANNEL,
  DESKTOP_HIDDEN_WORKER_REGISTER_RPC_METHOD,
  DESKTOP_HIDDEN_WORKER_TOUCH_RPC_METHOD,
  DESKTOP_HIDDEN_WORKER_UNREGISTER_RPC_METHOD,
} from '../definitions/hiddenWorkerHostRpc';
import {
  HiddenWorkerBooleanRpcSchema,
  HiddenWorkerDescriptorRpcSchema,
  HiddenWorkerVoidRpcSchema,
} from '../functions/hiddenWorkerHostRpcCodec';

export function createDesktopHiddenWorkerHostRpcClient(input: {
  readonly rpc: Pick<AppServerRpcPeer, 'request'>;
  readonly mailbox: DesktopCapabilityMailboxRpcClientPort;
  readonly onAsyncFailure: (error: Error) => void;
}): DesktopHiddenWorkerHostPort {
  const publish = (method: string, payload: Record<string, string>): void => {
    void input.rpc.request(method, payload)
      .then(HiddenWorkerVoidRpcSchema.parse)
      .catch((error: unknown) => input.onAsyncFailure(toError(error)));
  };
  const port: DesktopHiddenWorkerHostPort = {
    async registerHiddenWorker(descriptor, options = {}) {
      const response = await input.rpc.request(DESKTOP_HIDDEN_WORKER_REGISTER_RPC_METHOD, {
        descriptor: HiddenWorkerDescriptorRpcSchema.parse(descriptor),
        replace: options.replace === true,
      });
      HiddenWorkerVoidRpcSchema.parse(response);
    },
    async unregisterHiddenWorker(workerId) {
      const response = await input.rpc.request(
        DESKTOP_HIDDEN_WORKER_UNREGISTER_RPC_METHOD,
        { workerId },
      );
      return HiddenWorkerBooleanRpcSchema.parse(response);
    },
    ensureHiddenWorkerReady(workerId) {
      return input.mailbox.invoke(
        DESKTOP_HIDDEN_WORKER_ENSURE_READY_RPC_METHOD,
        DESKTOP_HIDDEN_WORKER_READY_MAILBOX_CHANNEL,
        [workerId],
      );
    },
    touchHiddenWorker(workerId) {
      publish(DESKTOP_HIDDEN_WORKER_TOUCH_RPC_METHOD, { workerId });
    },
    invokeHiddenWorker(workerId, invocation, options = {}) {
      return input.mailbox.invoke(
        DESKTOP_HIDDEN_WORKER_INVOKE_RPC_METHOD,
        DESKTOP_HIDDEN_WORKER_INVOKE_MAILBOX_CHANNEL,
        [workerId, invocation],
        options.signal ? { signal: options.signal } : undefined,
      );
    },
    invalidateHiddenWorker(workerId, reason) {
      publish(DESKTOP_HIDDEN_WORKER_INVALIDATE_RPC_METHOD, { workerId, reason });
    },
  };
  return Object.freeze(port);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
