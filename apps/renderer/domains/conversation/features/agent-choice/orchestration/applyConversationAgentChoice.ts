import type { ConversationSelectedAgentId } from '@app/schemas';
import { historyApiService } from '../../../history/services/historyApiService';
import type { Conversation } from '../../../types';
import {
  ensureMaterializedConversation,
  type ConversationMaterializationScopeStore,
} from '../../../services/orchestration/ensureMaterializedConversation';
import {
  requireConversationAgentChoiceById,
  type ConversationAgentChoiceDescriptor,
  type ConversationAgentChoiceId,
} from '../definitions/conversationAgentChoice';

export interface ConversationAgentChoiceAssistantStore {
  activeConversation: Conversation | null;
  createNewConversation: (projectId?: string | null) => string;
  setConversationSelectedAgent: (
    conversationId: string,
    selectedAgentId: ConversationSelectedAgentId | null,
  ) => void;
}

export interface ConversationAgentChoicePersistencePort {
  updateSelectedAgent: (
    conversationId: string,
    selectedAgentId: ConversationSelectedAgentId | null,
    projectId: string | null,
  ) => Promise<ConversationSelectedAgentId | null>;
}

export interface ApplyConversationAgentChoiceInput {
  readonly assistantStore: ConversationAgentChoiceAssistantStore;
  readonly scopeStore: ConversationMaterializationScopeStore;
  readonly agentChoiceId: ConversationAgentChoiceId | null;
  readonly choices: readonly ConversationAgentChoiceDescriptor[];
  readonly persistence?: ConversationAgentChoicePersistencePort;
}

export interface ConversationAgentChoiceResult {
  readonly conversationId: string;
  readonly selectedAgentId: ConversationSelectedAgentId | null;
}

function projectIdFromScope(scopeStore: ConversationMaterializationScopeStore): string | null {
  return scopeStore.currentScope.kind === 'project' ? scopeStore.currentScope.projectId : null;
}

/**
 * 持久化会话级 Agent 选择，并在 Host 确认后同步 Renderer read model。
 *
 * conversationId 与 projectId 必须在 await 前捕获，避免用户切换页面后把结果写到另一会话。
 */
export async function applyConversationAgentChoice(
  input: ApplyConversationAgentChoiceInput,
): Promise<ConversationAgentChoiceResult | null> {
  if (input.agentChoiceId === null && !input.assistantStore.activeConversation) {
    return null;
  }

  const selectedAgentId = input.agentChoiceId === null
    ? null
    : requireConversationAgentChoiceById(input.agentChoiceId, input.choices).agentId;
  const conversation = input.assistantStore.activeConversation
    ?? ensureMaterializedConversation(input.assistantStore, input.scopeStore);
  if (!conversation) {
    throw new Error('[conversation-agent-choice] failed to materialize conversation');
  }

  const conversationId = conversation.id;
  const projectId = projectIdFromScope(input.scopeStore);
  const persistedAgentId = await (input.persistence ?? historyApiService)
    .updateSelectedAgent(conversationId, selectedAgentId, projectId);
  input.assistantStore.setConversationSelectedAgent(conversationId, persistedAgentId);

  return { conversationId, selectedAgentId: persistedAgentId };
}
