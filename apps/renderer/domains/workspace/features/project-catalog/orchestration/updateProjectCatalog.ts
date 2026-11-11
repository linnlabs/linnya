import { projectGateway } from '@/shared/ipc/projectGateway';
import { useWorkspaceProjectsStore } from '../../../store/WorkspaceProjectsStore';
import { WorkspaceOperationError } from '../../../definitions/workspaceOperationError';
import type { ProjectUpdate } from '../../../definitions/project';

/**
 * 更新项目信息
 */
export async function updateProjectCatalog(
  projectId: string,
  updates: ProjectUpdate
): Promise<void> {
  try {
    const result = await projectGateway.update({
      projectId,
      name: updates.name,
      description: updates.description,
    });

    if (result.success) {
      useWorkspaceProjectsStore().applyProjectUpdate(projectId, updates);
    } else {
      throw new WorkspaceOperationError(result);
    }
  } catch (e) {
    console.error(`[ProjectCatalog] Failed to update project ${projectId}:`, e);
    throw e;
  }
}
