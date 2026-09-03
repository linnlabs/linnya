import { nextTick } from 'vue';
import { useLayoutStore } from '@/app/layout/store/layoutStore';
import { useSidebarConversationHistoryRevealStore } from '@/app/layout/store/sidebarConversationHistoryRevealStore';
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';
import { useUIStore } from '@/shared/stores/ui';
import {
  useWorkspaceScopeStore,
  type WorkspaceScope,
} from '@/shared/stores/workspaceScopeStore';

function cloneScope(scope: WorkspaceScope): WorkspaceScope {
  return scope.kind === 'project'
    ? { kind: 'project', projectId: scope.projectId }
    : { kind: 'linnya-assistant' };
}

/**
 * 从顶部历史下拉跳转到左侧侧边栏历史列表。
 *
 * 中文说明：
 * - “全部历史对话”不再打开第二套历史面板，而是把侧边栏作为唯一历史入口。
 * - 这里同时处理跨页面跳转、侧边栏自动打开、项目态 chat tab 切换和一次性视觉揭示。
 */
export async function revealSidebarConversationHistory(scope?: WorkspaceScope): Promise<void> {
  const uiStore = useUIStore();
  const layoutStore = useLayoutStore();
  const workspaceScopeStore = useWorkspaceScopeStore();
  const revealStore = useSidebarConversationHistoryRevealStore();
  const navigation = getWorkspaceNavigationPort();
  const targetScope = cloneScope(scope ?? workspaceScopeStore.currentScope);

  uiStore.setSidebarVisible(true);
  await navigation.openWorkspace(targetScope);

  if (targetScope.kind === 'project') {
    layoutStore.setSidebarNav('project');
  } else {
    layoutStore.setSidebarNav('list');
  }
  layoutStore.setSidebarMode('chat');

  await nextTick();
  revealStore.requestReveal(targetScope);
}
