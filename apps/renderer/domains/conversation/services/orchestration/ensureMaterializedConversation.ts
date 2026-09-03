import type { BaseMessage, Conversation } from '../../types';
import {
  type WorkspaceScope,
} from '../../../../shared/stores/workspaceScopeStore';
import { hasRenderableConversationMessages } from '../../functions/renderableConversationMessage';
import { useConversationTitleFeature } from '../../features/conversation-title';

export interface ConversationMaterializationAssistantStore {
  activeConversation: Conversation | null;
  createNewConversation: (projectId?: string | null) => string;
}

export interface ConversationMaterializationScopeStore {
  currentScope: WorkspaceScope;
  materializeCurrentDraft: (conversationId: string) => void;
}

function resolveProjectIdFromScope(scope: WorkspaceScope): string | null {
  return scope.kind === 'project' ? scope.projectId : null;
}

/**
 * 把当前空白草稿正式化为 conversation。
 *
 * 中文说明：
 * - “创建 conversation + materialize draft”必须是同一个业务动作；
 * - 各业务入口不能各自直接 `createNewConversation`，否则历史归属和 scope 会再次分叉；
 * - 已有活跃 conversation 时，本函数不做额外写入，只返回当前会话。
 */
export function ensureMaterializedConversation(
  assistantStore: ConversationMaterializationAssistantStore,
  scopeStore: ConversationMaterializationScopeStore
): Conversation | null {
  if (assistantStore.activeConversation) {
    return assistantStore.activeConversation;
  }

  const conversationId = assistantStore.createNewConversation(resolveProjectIdFromScope(scopeStore.currentScope));
  scopeStore.materializeCurrentDraft(conversationId);
  useConversationTitleFeature().registerAutomaticCandidate(conversationId);

  return assistantStore.activeConversation;
}

export function hasRenderableConversationContent(
  conversation: Conversation | null | undefined,
  messages: readonly BaseMessage[] = conversation?.messages ?? [],
): boolean {
  return conversation ? hasRenderableConversationMessages(messages) : false;
}
