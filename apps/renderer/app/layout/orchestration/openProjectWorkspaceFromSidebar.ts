import { useWorkspaceProjectsStore } from '@/domains/workspace/store/WorkspaceProjectsStore';
import { useWorkspaceTreeStore } from '@/domains/workspace/store/WorkspaceTreeStore';
import { startDraftConversation } from '@/domains/conversation/services/orchestration/startDraftConversation';
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';
import {
  areWorkspaceScopesEqual,
  useWorkspaceScopeStore,
  type ProjectWorkspaceScope,
} from '@/shared/stores/workspaceScopeStore';

/**
 * 从侧边栏进入项目工作区。
 *
 * 中文说明：scope 只能由 workspaceNavigation 在文档保存并停用后提交。
 * 如果这里提前改 scope，导航会把跨项目切换误判为重复进入当前项目，
 * 从而保留上一个项目的 activeDocument。
 */
export async function openProjectWorkspaceFromSidebar(projectId: string): Promise<void> {
  const workspaceScopeStore = useWorkspaceScopeStore();
  const targetScope: ProjectWorkspaceScope = { kind: 'project', projectId };
  const isSameProjectScope = areWorkspaceScopesEqual(
    workspaceScopeStore.currentScope,
    targetScope,
  );

  await getWorkspaceNavigationPort().openWorkspace(targetScope);

  useWorkspaceProjectsStore().markActiveProject(projectId);
  if (!isSameProjectScope) {
    startDraftConversation(targetScope);
  }

  await useWorkspaceTreeStore().ensureProjectTreeLoaded(projectId);
}
