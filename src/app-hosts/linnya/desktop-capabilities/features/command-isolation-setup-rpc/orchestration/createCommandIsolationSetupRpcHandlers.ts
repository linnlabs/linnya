import type { AppServerRpcHandler, AppServerRpcHandlerRegistry } from '../../../../app-server-rpc';
import type { DesktopCommandIsolationSetupPort } from '../../../definitions/desktopCommandIsolationSetupPort';
import { COMMAND_ISOLATION_SETUP_RPC_METHOD, CommandIsolationSetupRequestSchema } from '../definitions/commandIsolationSetupRpc';

export function createCommandIsolationSetupRpcHandlers(port: DesktopCommandIsolationSetupPort): AppServerRpcHandlerRegistry {
  return new Map<string, AppServerRpcHandler>([[COMMAND_ISOLATION_SETUP_RPC_METHOD, async payload => {
    CommandIsolationSetupRequestSchema.parse(payload);
    return port.ensureReady();
  }]]);
}
