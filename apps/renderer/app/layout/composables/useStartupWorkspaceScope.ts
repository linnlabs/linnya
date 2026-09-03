import { onMounted } from 'vue';
import { useWorkspaceScopeStore } from '@/shared/stores/workspaceScopeStore';
import { useWorkspaceProjectsStore } from '@/domains/workspace/store/WorkspaceProjectsStore';
import { startDraftConversation } from '@/domains/conversation/services/orchestration/startDraftConversation';
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';

function findStartupProjectId(
  lastProjectId: string | null,
  projects: { id: string }[],
): string | null {
  if (lastProjectId && projects.some((project) => project.id === lastProjectId)) {
    return lastProjectId;
  }

  return projects[0]?.id ?? null;
}

/**
 * 启动时进入“项目的新对话”。
 *
 * 中文说明：
 * - 项目入口默认就是该项目下的空白草稿对话；
 * - 历史会话只在用户从历史列表显式选择时加载；
 * - 如果上次项目不存在，则落到第一个可用项目；项目列表加载失败时才回到 Linnya 助手。
 */
export function useStartupWorkspaceScope(): void {
  const workspaceScopeStore = useWorkspaceScopeStore();
  const projectsStore = useWorkspaceProjectsStore();
  const navigation = getWorkspaceNavigationPort();

  onMounted(async () => {
    await projectsStore.loadProjects();

    const startupProjectId = findStartupProjectId(
      workspaceScopeStore.currentProjectId,
      projectsStore.projects,
    );

    if (startupProjectId) {
      navigation.openWorkspace({ kind: 'project', projectId: startupProjectId });
      projectsStore.setActiveProject(startupProjectId);
      startDraftConversation({ kind: 'project', projectId: startupProjectId });
      return;
    }

    navigation.openWorkspace({ kind: 'linnya-assistant' });
    startDraftConversation({ kind: 'linnya-assistant' });
  });
}
