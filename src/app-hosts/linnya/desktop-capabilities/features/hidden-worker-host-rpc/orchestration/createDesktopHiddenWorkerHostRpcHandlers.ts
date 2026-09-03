import type {
  AppServerRpcHandler,
  AppServerRpcHandlerRegistry,
} from '../../../../app-server-rpc';
import type {
  DesktopHiddenWorkerDescriptor,
  DesktopHiddenWorkerHostPort,
} from '../../../definitions/desktopHiddenWorkerHostPort';
import { createDesktopCapabilityMailboxRpcHandler } from '../../../shared/mailbox-rpc/orchestration/createDesktopCapabilityMailboxRpcHandler';
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
  HiddenWorkerIdRpcSchema,
  HiddenWorkerInvalidateRpcSchema,
  HiddenWorkerRegisterRpcSchema,
  parseHiddenWorkerInvocationRpc,
} from '../functions/hiddenWorkerHostRpcCodec';

export function createDesktopHiddenWorkerHostRpcHandlers(input: {
  readonly port: DesktopHiddenWorkerHostPort;
  readonly mailboxRoot: string;
  readonly assertDescriptorAllowed: (descriptor: DesktopHiddenWorkerDescriptor) => void;
}): AppServerRpcHandlerRegistry {
  const ensureReady = createDesktopCapabilityMailboxRpcHandler({
    mailboxRoot: input.mailboxRoot,
    channel: DESKTOP_HIDDEN_WORKER_READY_MAILBOX_CHANNEL,
    invoke: async args => {
      const workerId = readWorkerIdArg(args);
      return await input.port.ensureHiddenWorkerReady(workerId);
    },
  });
  const invoke = createDesktopCapabilityMailboxRpcHandler({
    mailboxRoot: input.mailboxRoot,
    channel: DESKTOP_HIDDEN_WORKER_INVOKE_MAILBOX_CHANNEL,
    invoke: async (args, context) => {
      if (args.length !== 2) throw new Error('Hidden worker invocation 参数数量不合法');
      const workerId = HiddenWorkerIdRpcSchema.parse({ workerId: args[0] }).workerId;
      const invocation = parseHiddenWorkerInvocationRpc(args[1]);
      return await input.port.invokeHiddenWorker(
        workerId,
        invocation,
        { signal: context.signal },
      );
    },
  });

  return new Map<string, AppServerRpcHandler>([
    [DESKTOP_HIDDEN_WORKER_REGISTER_RPC_METHOD, async payload => {
      const request = HiddenWorkerRegisterRpcSchema.parse(payload);
      input.assertDescriptorAllowed(request.descriptor);
      await input.port.registerHiddenWorker(
        request.descriptor,
        request.replace ? { replace: true } : undefined,
      );
      return null;
    }],
    [DESKTOP_HIDDEN_WORKER_UNREGISTER_RPC_METHOD, async payload => {
      const request = HiddenWorkerIdRpcSchema.parse(payload);
      return await input.port.unregisterHiddenWorker(request.workerId);
    }],
    [DESKTOP_HIDDEN_WORKER_ENSURE_READY_RPC_METHOD, ensureReady],
    [DESKTOP_HIDDEN_WORKER_TOUCH_RPC_METHOD, payload => {
      const request = HiddenWorkerIdRpcSchema.parse(payload);
      input.port.touchHiddenWorker(request.workerId);
      return null;
    }],
    [DESKTOP_HIDDEN_WORKER_INVOKE_RPC_METHOD, invoke],
    [DESKTOP_HIDDEN_WORKER_INVALIDATE_RPC_METHOD, payload => {
      const request = HiddenWorkerInvalidateRpcSchema.parse(payload);
      input.port.invalidateHiddenWorker(request.workerId, request.reason);
      return null;
    }],
  ]);
}

function readWorkerIdArg(args: readonly unknown[]): string {
  if (args.length !== 1) throw new Error('Hidden worker ready 参数数量不合法');
  return HiddenWorkerIdRpcSchema.parse({ workerId: args[0] }).workerId;
}
