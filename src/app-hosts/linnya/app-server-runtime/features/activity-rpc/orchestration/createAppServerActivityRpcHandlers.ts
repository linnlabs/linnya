import type {
  AppServerRpcHandler,
  AppServerRpcHandlerRegistry,
} from '../../../../app-server-rpc';
import type { AppServerActivitySourcePort } from '../definitions/appServerActivityRpc';
import {
  BACKEND_APP_ACTIVITY_PAUSE_AGENT_RUNS_RPC_METHOD,
  BACKEND_APP_ACTIVITY_READ_RPC_METHOD,
} from '../definitions/appServerActivityRpc';
import {
  encodeAppServerActivitySnapshot,
  encodeAppServerPauseAgentRunsResult,
  parseAppServerActivityReadRequest,
  parseAppServerPauseAgentRunsRequest,
} from '../functions/appServerActivityRpcCodec';

export function createAppServerActivityRpcHandlers(
  source: AppServerActivitySourcePort,
): AppServerRpcHandlerRegistry {
  return new Map<string, AppServerRpcHandler>([
    [BACKEND_APP_ACTIVITY_READ_RPC_METHOD, async payload => {
      parseAppServerActivityReadRequest(payload);
      return encodeAppServerActivitySnapshot({
        hasExecutingCommands: source.hasExecutingCommands(),
        activeAgentRuns: await source.listActiveAgentRuns(),
        knowledgeIngestionActive: source.hasActiveKnowledgeIngestion(),
      });
    }],
    [BACKEND_APP_ACTIVITY_PAUSE_AGENT_RUNS_RPC_METHOD, async payload => {
      parseAppServerPauseAgentRunsRequest(payload);
      return encodeAppServerPauseAgentRunsResult(await source.pauseActiveAgentRuns());
    }],
  ]);
}
