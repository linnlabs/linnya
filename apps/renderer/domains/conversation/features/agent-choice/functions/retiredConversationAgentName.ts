import { RETIRED_DEEP_RESEARCH_AGENT_IDS, isRetiredDeepResearchAgentId } from '@app/schemas';
import type { ConversationMessageResolver } from '../../../definitions/conversationMessages';

/**
 * 已删除定义的旧 Agent 在历史中的可读名称；不是可选 Agent，也不映射到新版执行。
 * 查不到时返回 null，由调用方按“Agent 已不可用”或注册表 ID 处理。
 */
export function resolveRetiredConversationAgentName(
  agentId: string,
  message: ConversationMessageResolver,
): string | null {
  return isRetiredDeepResearchAgentId(agentId)
    ? message('conversation.input.agentChoice.retiredDeepResearch')
    : null;
}

/** 供按 Agent ID 查名的读取面一次性补齐全部退役身份。 */
export function listRetiredConversationAgentNames(
  message: ConversationMessageResolver,
): ReadonlyArray<readonly [string, string]> {
  const name = message('conversation.input.agentChoice.retiredDeepResearch');
  return RETIRED_DEEP_RESEARCH_AGENT_IDS.map(agentId => [agentId, name] as const);
}
