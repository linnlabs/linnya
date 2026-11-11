import { projectGateway } from '@/shared/ipc/projectGateway';
import { useWorkspaceProjectsStore } from '../../../store/WorkspaceProjectsStore';
import { toProject } from '../../../shared/projectRecord';
import { resolveCurrentWorkspaceMessage } from '../../../functions/resolveCurrentWorkspaceMessage';
import { WorkspaceOperationError } from '../../../definitions/workspaceOperationError';

/**
 * 加载所有项目列表，如果为空则自动创建默认项目
 */
export async function loadProjectCatalog(): Promise<void> {
  const store = useWorkspaceProjectsStore();
  store.setProjectsLoading(true);
  store.setProjectsError(null);
  try {
    const result = await projectGateway.list();
    if (result.success) {
      store.replaceProjects(result.data.projects.map(toProject));

      // 如果没有任何项目，自动创建默认项目
      if (store.projects.length === 0) {
        console.log('[ProjectCatalog] 没有项目，创建默认项目...');
        await createDefaultProject();
        // 重新加载项目列表
        const reloadResult = await projectGateway.list();
        if (reloadResult.success) {
          store.replaceProjects(reloadResult.data.projects.map(toProject));
        }
      }
    } else {
      throw new WorkspaceOperationError(result);
    }
  } catch (e) {
    console.error('[ProjectCatalog] Failed to load projects:', e);
    store.setProjectsError(resolveCurrentWorkspaceMessage('workspace.sidebar.state.error'));
    store.replaceProjects([]);
  } finally {
    store.setProjectsLoading(false);
  }
}

/**
 * 确保系统默认项目存在
 */
async function createDefaultProject(): Promise<string> {
  try {
    const result = await projectGateway.ensureDefault();
    if (!result.success) {
      throw new WorkspaceOperationError(result);
    }
    console.log('[ProjectCatalog] 默认项目已就绪:', result.data.projectId);
    return result.data.projectId;
  } catch (error) {
    console.error('[ProjectCatalog] 创建默认项目失败:', error);
    throw error;
  }
}
