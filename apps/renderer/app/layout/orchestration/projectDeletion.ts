import { useNavigationScope } from '@/app/navigation';
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';
import { useWorkspaceProjectsStore } from '@/domains/workspace/store/WorkspaceProjectsStore';
import { useWorkspaceTreeStore } from '@/domains/workspace/store/WorkspaceTreeStore';
import { refreshProjectCatalog } from '@/domains/workspace/features/project-catalog';

/** 外部空项目删除已提交；只退出失效项目，不干扰其他项目的导航与草稿。 */
export async function handleProjectDeleted(projectId: string): Promise<void> {
  await refreshProjectCatalog();
  const navigation = useNavigationScope();
  if (navigation.currentProjectId === projectId) {
    await getWorkspaceNavigationPort().openWorkspace({ kind: 'linnya-assistant' });
    navigation.startDraft(navigation.currentScope);
  }
  const projects = useWorkspaceProjectsStore();
  if (projects.activeProjectId === projectId) projects.clearActiveProject();
  const tree = useWorkspaceTreeStore();
  if (tree.loadedProjectId === projectId) tree.clearTree();
  navigation.forgetLastActiveConversation({ kind: 'project', projectId });
}
