import type { AppServerRpcRequestOptions } from '../../../../app-server-rpc';

export const DESKTOP_CAPABILITY_MAILBOX_PROTOCOL_VERSION = 1 as const;

export interface DesktopCapabilityMailboxRpcClientPort {
  invoke(
    method: string,
    channel: string,
    args: readonly unknown[],
    options?: AppServerRpcRequestOptions,
  ): Promise<unknown>;
}
