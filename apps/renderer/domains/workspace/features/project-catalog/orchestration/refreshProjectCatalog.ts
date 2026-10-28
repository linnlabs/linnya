import { projectGateway } from '@/shared/ipc/projectGateway';
import { useWorkspaceProjectsStore } from '../../../store/WorkspaceProjectsStore';
import { WorkspaceOperationError } from '../../../definitions/workspaceOperationError';
import { toProject } from '../../../shared/projectRecord';

/** 项目通知只刷新目录；不复用启动时会创建默认项目的 loadProjects，也不触碰导航或文档树。 */
export async function refreshProjectCatalog(): Promise<void> {
  const store = useWorkspaceProjectsStore();
  const response = await projectGateway.list();
  if (!response.success) throw new WorkspaceOperationError(response);
  store.replaceProjects(response.data.projects.map(toProject));
}
