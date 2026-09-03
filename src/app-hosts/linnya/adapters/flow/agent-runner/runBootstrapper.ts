import type { ConversationNextRequest } from '@app/schemas';
import { enrichment, runContext, tools } from 'linnkit/runtime-kernel';
import { ensureBuiltinRequestEnrichersRegistered } from 'src/app-hosts/linnya/agent-registry/builtin';
import type { DatabaseService } from 'src/electron-main/services/database';
import type { AgentInvokeRequest } from 'src/app-hosts/linnya/context/agent/contracts';
import type { RunId } from 'linnkit/contracts';
type RunContext = runContext.RunContext;
type ToolContextPatch = tools.ToolContextPatch;

export interface PreparedRunBootstrap {
  turnId: string;
  finalReq: AgentInvokeRequest;
  finalRunContext: RunContext;
  toolContextPatch: ToolContextPatch;
}

export function resolveTurnId(
  options: ConversationNextRequest['options'],
  newEvents: ConversationNextRequest['new_events'] = []
): string {
  const optionTurnId = (options as { turn_id?: unknown } | undefined)?.turn_id;
  if (typeof optionTurnId === 'string' && optionTurnId.trim().length > 0) {
    return optionTurnId.trim();
  }
  const eventTurnId = Array.isArray(newEvents) ? newEvents[0]?.turn_id : undefined;
  if (typeof eventTurnId === 'string' && eventTurnId.trim().length > 0) {
    return eventTurnId.trim();
  }
  return `turn_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

export async function prepareRunBootstrap(params: {
  databaseService: DatabaseService;
  conversationId: string;
  turnId: string;
  runId: RunId;
  request: AgentInvokeRequest;
}): Promise<PreparedRunBootstrap> {
  const initialRunContext = runContext.createRunContext({
    runId: params.runId,
    traceId: params.request.review_run_id ?? params.runId,
    rootRunId: params.runId,
    tags: {
      promptKey: params.request.promptKey,
    },
  });

  ensureBuiltinRequestEnrichersRegistered({ databaseService: params.databaseService });

  const enrichmentResult = await enrichment.requestEnricherRegistry.enrich({
    conversationId: params.conversationId,
    request: params.request,
    runContext: initialRunContext,
  });

  return {
    turnId: params.turnId,
    /**
     * 中文备注：
     * - enrichment registry 返回 AgentInvocationRequest（runtime 最小协议面）；
     * - 产品扩展字段仍由原始 AgentInvokeRequest 持有；runtime enrichment 只覆盖其公开协议字段；
     * - 显式合并让字段保留成为数据流事实，不依赖不安全的类型断言。
     */
    finalReq: {
      ...params.request,
      ...enrichmentResult.request,
    },
    finalRunContext: enrichmentResult.runContext,
    toolContextPatch: enrichmentResult.toolContextPatch ?? {},
  };
}
