import type { ConversationSelectedAgentId } from '@app/schemas';
import type { ConversationAgentChoiceContribution } from '@plugin/renderer/pluginContribution';

/** Renderer 菜单项身份；与 AgentDefinition.id 分属不同身份空间。 */
export type ConversationAgentChoiceId = string;

export type ConversationAgentChoiceDescriptor = ConversationAgentChoiceContribution;

export function resolveConversationAgentChoice(
  selectedAgentId: ConversationSelectedAgentId | null,
  choices: readonly ConversationAgentChoiceDescriptor[],
): ConversationAgentChoiceDescriptor | null {
  if (selectedAgentId === null) return null;
  return choices.find((choice) => choice.agentId === selectedAgentId) ?? null;
}

export function resolveConversationAgentChoiceById(
  agentChoiceId: ConversationAgentChoiceId,
  choices: readonly ConversationAgentChoiceDescriptor[],
): ConversationAgentChoiceDescriptor | null {
  return choices.find((choice) => choice.id === agentChoiceId) ?? null;
}

export function requireConversationAgentChoiceById(
  agentChoiceId: ConversationAgentChoiceId,
  choices: readonly ConversationAgentChoiceDescriptor[],
): ConversationAgentChoiceDescriptor {
  const choice = resolveConversationAgentChoiceById(agentChoiceId, choices);
  if (!choice) {
    throw new Error(`[conversation-agent-choice] unknown choice id: ${agentChoiceId}`);
  }
  return choice;
}
