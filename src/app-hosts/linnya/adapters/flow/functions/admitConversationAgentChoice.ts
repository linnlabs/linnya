import type { ConversationNextRequest } from '@app/schemas';
import { findRegisteredAgentDefinitionById } from 'src/app-hosts/linnya/agent-registry/agentDefinitionResolver';

/**
 * 产品 Agent 身份到 Host 内部 promptKey 的唯一解析边界。
 * start 与 wait-user resume 必须复用它，避免同一逻辑 run 在恢复时掉回 default。
 */
export function resolveConversationAgentPromptKey(agentId: string): string {
  const definition = findRegisteredAgentDefinitionById(agentId);
  if (!definition) {
    throw new Error(`[FlowRouter] selected agent is unavailable: ${agentId}`);
  }
  return definition.promptKey;
}

/**
 * 把跨端产品 Agent 身份解析为 Host 内部 promptKey。
 *
 * selected_agent_id 在此边界完成职责，不得继续进入 HistoryBuilder 或 Runtime read model。
 */
export function admitConversationAgentChoice(
  request: ConversationNextRequest,
): ConversationNextRequest {
  const options = request.options;
  if (!options || options.selected_agent_id === undefined) return request;
  const selectedAgentId = options.selected_agent_id;

  const { selected_agent_id: _selectedAgentId, ...internalOptions } = options;
  return {
    ...request,
    options: {
      ...internalOptions,
      promptKey: resolveConversationAgentPromptKey(selectedAgentId),
    },
  };
}
