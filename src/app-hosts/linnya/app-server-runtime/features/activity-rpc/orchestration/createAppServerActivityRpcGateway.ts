import type { AppServerRpcPeer } from '../../../../app-server-rpc';
import type { AppServerActivityGatewayPort } from '../definitions/appServerActivityRpc';
import {
  APP_SERVER_PAUSE_AGENT_RUNS_TIMEOUT_MS,
  BACKEND_APP_ACTIVITY_PAUSE_AGENT_RUNS_RPC_METHOD,
  BACKEND_APP_ACTIVITY_READ_RPC_METHOD,
} from '../definitions/appServerActivityRpc';
import {
  parseAppServerActivitySnapshot,
  parseAppServerPauseAgentRunsResult,
} from '../functions/appServerActivityRpcCodec';

export function createAppServerActivityRpcGateway(
  rpc: Pick<AppServerRpcPeer, 'request'>,
): AppServerActivityGatewayPort {
  return Object.freeze({
    async read() {
      return parseAppServerActivitySnapshot(
        await rpc.request(BACKEND_APP_ACTIVITY_READ_RPC_METHOD, null),
      );
    },
    async pauseAgentRuns() {
      return parseAppServerPauseAgentRunsResult(
        await rpc.request(BACKEND_APP_ACTIVITY_PAUSE_AGENT_RUNS_RPC_METHOD, null, {
          timeoutMs: APP_SERVER_PAUSE_AGENT_RUNS_TIMEOUT_MS,
        }),
      );
    },
  });
}
