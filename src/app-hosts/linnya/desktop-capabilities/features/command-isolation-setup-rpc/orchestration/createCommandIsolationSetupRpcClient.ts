import type { AppServerRpcPeer } from '../../../../app-server-rpc';
import type { DesktopCommandIsolationSetupPort } from '../../../definitions/desktopCommandIsolationSetupPort';
import { COMMAND_ISOLATION_SETUP_RPC_METHOD, CommandIsolationSetupResponseSchema } from '../definitions/commandIsolationSetupRpc';

export function createCommandIsolationSetupRpcClient(rpc: Pick<AppServerRpcPeer, 'request'>): DesktopCommandIsolationSetupPort {
  return {
    async ensureReady() {
      // 首次确认和系统 UAC 包含用户操作时间，不能复用普通高频 RPC 的短截止时间。
      return CommandIsolationSetupResponseSchema.parse(await rpc.request(
        COMMAND_ISOLATION_SETUP_RPC_METHOD, null, { timeoutMs: 300_000 },
      ));
    },
  };
}
