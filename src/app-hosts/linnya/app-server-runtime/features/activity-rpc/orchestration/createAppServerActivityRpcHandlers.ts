import type { BackendRuntimeOwner } from '../../../../backend-runtime/orchestration/backendRuntimeOwner';
import type {
  AppServerRpcHandler,
  AppServerRpcHandlerRegistry,
} from '../../../../app-server-rpc';
import { BACKEND_APP_ACTIVITY_READ_RPC_METHOD } from '../definitions/appServerActivityRpc';
import { parseAppServerActivityReadRequest } from '../functions/appServerActivityRpcCodec';

export function createAppServerActivityRpcHandlers(
  runtimeOwner: Pick<BackendRuntimeOwner, 'hasExecutingCommands'>,
): AppServerRpcHandlerRegistry {
  return new Map<string, AppServerRpcHandler>([
    [BACKEND_APP_ACTIVITY_READ_RPC_METHOD, payload => {
      parseAppServerActivityReadRequest(payload);
      return { has_executing_commands: runtimeOwner.hasExecutingCommands() };
    }],
  ]);
}
