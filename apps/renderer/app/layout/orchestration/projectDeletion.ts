import { useNavigationScope } from '@/app/navigation';
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';
import { useWorkspaceProjectsStore } from '@/domains/workspace/store/WorkspaceProjectsStore';
import { useWorkspaceTree } from '@/domains/workspace/tree';
import { refreshProjectCatalog } from '@/domains/workspace/features/project-catalog';
import { projectGateway } from '@/shared/ipc/projectGateway';
import { WorkspaceOperationError } from '@/domains/workspace/definitions/workspaceOperationError';
import { useLayoutStore } from '../store/layoutStore';
import { useSidebarConversationHistoryRevealStore } from '../store/sidebarConversationHistoryRevealStore';
import { deactivateIfActiveDocument } from '@/domains/workspace/services/file-manager';
import { startDraftConversation } from '@/domains/conversation/services/orchestration/startDraftConversation';

/** Desktop 删除成功后与外部项目删除共用收尾；失败不会提前改变导航或活动文档。 */
export async function deleteProjectFromSidebar(projectId: string): Promise<void> {
  const response = await projectGateway.delete(projectId);
  if (!response.success) throw new WorkspaceOperationError(response);
  await handleProjectDeleted(projectId);
}

/** 删除事实已提交；只退出失效项目，不干扰其他项目的导航与草稿。 */
export async function handleProjectDeleted(projectId: string): Promise<void> {
  await refreshProjectCatalog();
  const navigation = useNavigationScope();
  if (navigation.currentProjectId === projectId) {
    const layout = useLayoutStore();
    const document = layout.state.activeDocument;
    if (document?.projectId === projectId) {
      // 文档已随项目删除，先停用文件会话，避免普通导航尝试把它保存回不存在的项目。
      await deactivateIfActiveDocument(document.id);
    }
    await getWorkspaceNavigationPort().openWorkspace({ kind: 'linnya-assistant' });
    startDraftConversation({ kind: 'linnya-assistant' });
    layout.setSidebarNav('list');
    useSidebarConversationHistoryRevealStore().dismiss();
  }
  const projects = useWorkspaceProjectsStore();
  if (projects.activeProjectId === projectId) projects.clearActiveProject();
  const tree = useWorkspaceTree();
  if (tree.loadedProjectId === projectId) tree.clearTree();
  navigation.forgetLastActiveConversation({ kind: 'project', projectId });
}
