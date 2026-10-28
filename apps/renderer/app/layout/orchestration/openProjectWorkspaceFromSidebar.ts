import { useWorkspaceProjectsStore } from '@/domains/workspace/store/WorkspaceProjectsStore';
import { useWorkspaceTreeStore } from '@/domains/workspace/store/WorkspaceTreeStore';
import { startDraftConversation } from '@/domains/conversation/services/orchestration/startDraftConversation';
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';
import {
  areNavigationScopesEqual,
  useNavigationScope,
  type ProjectNavigationScope,
} from '@/app/navigation';

/**
 * 从侧边栏进入项目工作区。
 *
 * 中文说明：scope 只能由 workspaceNavigation 在文档保存并停用后提交。
 * 如果这里提前改 scope，导航会把跨项目切换误判为重复进入当前项目，
 * 从而保留上一个项目的 activeDocument。
 */
export async function openProjectWorkspaceFromSidebar(projectId: string): Promise<void> {
  const navigationScope = useNavigationScope();
  const targetScope: ProjectNavigationScope = { kind: 'project', projectId };
  const isSameProjectScope = areNavigationScopesEqual(
    navigationScope.currentScope,
    targetScope,
  );

  await getWorkspaceNavigationPort().openWorkspace(targetScope);

  useWorkspaceProjectsStore().markActiveProject(projectId);
  if (!isSameProjectScope) {
    startDraftConversation(targetScope);
  }

  await useWorkspaceTreeStore().ensureProjectTreeLoaded(projectId);
}
