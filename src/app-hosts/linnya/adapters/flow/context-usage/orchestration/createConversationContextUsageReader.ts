import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { isRetiredDeepResearchAgentId, type ConversationContextUsage } from '@app/schemas';
import { mergeContextPolicy } from '@linnlabs/linnkit/context-manager';
import type { agentTools } from '@linnlabs/linnkit/context-manager';
import type { RuntimeEvent } from '@linnlabs/linnkit/contracts';
import { llm, type ToolRuntimePort } from '@linnlabs/linnkit/runtime-kernel';
import { createDefaultGraphExecutorContextBuilder } from 'src/app-hosts/linnya/adapters/context-injection/defaultGraphExecutorContextBuilder';
import { defaultImageInputProcessingProfileRegistry } from 'src/app-hosts/linnya/adapters/llm-input-materialization';
import { LINNYA_CONTEXT_POLICY_FALLBACK } from 'src/app-hosts/linnya/context-policies/defaultContextPolicy';
import { modelCatalog } from 'src/domains/model-catalog';
import { AgentRequestAdmissionError } from 'src/app-hosts/linnya/agent-registry/agentRequestAdmissionError';
import { resolveAgentRequestAdmission } from 'src/app-hosts/linnya/agent-registry/resolveAgentRequestAdmission';
import type { AgentInvokeRequest } from 'src/app-hosts/linnya/context/agent/contracts';
import type { ConversationListItem } from '../../../persistence/event-store/event-store.interface';
import { HistoryBuilder } from '../../flow.history-builder.service';
import { resolveConversationAgentPromptKey } from '../../functions/admitConversationAgentChoice';
import { projectContextEstimate } from '../functions/projectContextEstimate';

interface ContextUsageReaderDependencies {
  readMetadata(conversationId: string): Promise<ConversationListItem | null>;
  readHistory(conversationId: string): Promise<RuntimeEvent[]>;
  readonly toolRuntime: Pick<ToolRuntimePort, 'getToolSchemas'>;
  readonly toolManager?: agentTools.ToolManager;
}

/**
 * 下一次运行要先经过 Agent 自己的接纳规则（例如研究的开放范围）。估算与正式运行共用它，
 * 只是用户消息尚未写出；被接纳规则拒绝时没有可估算的请求，历史照常打开。
 */
function admitNextRequest(
  request: AgentInvokeRequest,
  history: readonly RuntimeEvent[],
): AgentInvokeRequest | null {
  try {
    return resolveAgentRequestAdmission(request, { history, contextEstimate: true });
  } catch (error) {
    if (error instanceof AgentRequestAdmissionError) return null;
    throw error;
  }
}

export function createConversationContextUsageReader(dependencies: ContextUsageReaderDependencies) {
  const tokenizer = llm.createDefaultTokenizerPort(
    mergeContextPolicy({ hostFallback: LINNYA_CONTEXT_POLICY_FALLBACK }).tokenEstimation,
  );
  // 只复用本地上下文准备，不注册 run，不安装远端计数器，也不执行 Agent 请求增强器。
  const builder = createDefaultGraphExecutorContextBuilder({
    tokenizer,
    toolManager: dependencies.toolManager,
    imageInputEstimator: defaultImageInputProcessingProfileRegistry,
  });
  let latest: { key: string; usage: Promise<ConversationContextUsage | null> } | undefined;

  async function estimate(metadata: ConversationListItem, modelId: string) {
    // 历史窗口读请求可以先处理，避免本地分词占住打开对话时的第一批 I/O。
    await yieldToEventLoop();
    const conversationId = metadata.conversation_id;
    const history = await dependencies.readHistory(conversationId);
    const request = admitNextRequest(
      HistoryBuilder.buildForContextEstimate(conversationId, {
        model_id: modelId,
        promptKey: metadata.selected_agent_id
          ? resolveConversationAgentPromptKey(metadata.selected_agent_id)
          : undefined,
        project_metadata: metadata.project_id ? { id: metadata.project_id } : undefined,
      }),
      history,
    );
    if (!request) return null;
    const tools = request.enableTools === false ? [] : dependencies.toolRuntime.getToolSchemas({
      toolNames: request.availableTools,
      invocation: request,
    }).map(({ function: { name, description, parameters } }) => ({ name, description, parameters }));
    const toolDefinitionTokens = tools.length === 0 ? 0
      : tokenizer.estimateText(JSON.stringify({ tools, tool_choice: 'auto' }), modelId);
    const context = await builder.build({ request, history, modelId, toolDefinitionTokens });
    return projectContextEstimate(modelId, context);
  }

  return async (conversationId: string, modelId: string): Promise<ConversationContextUsage | null> => {
    const model = modelCatalog.getModel(modelId);
    if (!model?.inference_route) return null;
    const metadata = await dependencies.readMetadata(conversationId);
    if (!metadata) return null;
    // 退役 Agent 不再接收新运行，没有可估算的下一次请求；历史照常打开。
    if (metadata.selected_agent_id && isRetiredDeepResearchAgentId(metadata.selected_agent_id)) {
      return null;
    }
    // 只保留最近一次估算。外部运行和截断改变持久化统计，历史翻页不会改变它们。
    const key = JSON.stringify([
      conversationId, metadata.created_at, metadata.last_event_at, metadata.total_events,
      metadata.project_id, metadata.selected_agent_id, modelId, model.inference_route, model.token_route,
    ]);
    if (latest?.key === key) return latest.usage;
    const entry = { key, usage: estimate(metadata, modelId) };
    latest = entry;
    try {
      return await entry.usage;
    } catch (error) {
      if (latest === entry) latest = undefined;
      throw error;
    }
  };
}
