import { useAssistantStore } from '../../store/assistantStore';
import { useConversationSelectionStore } from '../../history/store/conversationSelectionStore';
import { useWorkspaceScopeStore, type WorkspaceScope } from '../../../../shared/stores/workspaceScopeStore';

/**
 * 开启当前 scope 下的空白草稿对话。
 *
 * 中文说明：
 * - “新对话”在产品语义上只是进入一个可输入的草稿，不应该立刻创建历史会话；
 * - 第一次发送时，chatFlowOrchestrator 才会把草稿 materialize 成正式 conversation；
 * - 这里集中结束旧会话的活动态和侧边栏选择态，避免同一个会话身份残留两套不一致的高亮状态；
 * - Header/Sidebar 只触发该编排，不各自写清理逻辑。
 */
export function startDraftConversation(scope?: WorkspaceScope): void {
  const assistantStore = useAssistantStore();
  const conversationSelectionStore = useConversationSelectionStore();
  const workspaceScopeStore = useWorkspaceScopeStore();
  const targetScope = scope ?? workspaceScopeStore.currentScope;

  workspaceScopeStore.startDraft(targetScope);
  conversationSelectionStore.clear(targetScope);
  assistantStore.setSelectedConversation(null);
  assistantStore.clearActiveConversation();
  assistantStore.clearError();
}
