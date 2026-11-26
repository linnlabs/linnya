import { isRetiredDeepResearchAgentId, type ConversationNextRequest } from '@app/schemas';
import { findRegisteredAgentDefinitionById } from 'src/app-hosts/linnya/agent-registry/agentDefinitionResolver';

/**
 * 产品 Agent 身份到 Host 内部 promptKey 的唯一解析边界。
 * 选中的 Agent 未注册或所属插件已停用时返回 undefined；只读入口（如上下文用量估算）据此判断没有下一次请求。
 */
export function findConversationAgentPromptKey(agentId: string): string | undefined {
  // 退役身份的 id 与 promptKey 相同且已无 definition；保留原身份交给接纳/恢复入口拒绝或终止。
  if (isRetiredDeepResearchAgentId(agentId)) return agentId;
  return findRegisteredAgentDefinitionById(agentId)?.promptKey;
}

/**
 * 同一解析边界的必选版本：start 与 wait-user resume 必须复用它，避免同一逻辑 run 在恢复时掉回 default。
 */
export function resolveConversationAgentPromptKey(agentId: string): string {
  const promptKey = findConversationAgentPromptKey(agentId);
  if (promptKey === undefined) {
    throw new Error(`[FlowRouter] selected agent is unavailable: ${agentId}`);
  }
  return promptKey;
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
