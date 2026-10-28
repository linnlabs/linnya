import {
  ProjectCreateInputSchema,
  ProjectIdentityInputSchema,
  ProjectUpdateRequestSchema,
} from '@app/schemas';
import type { ProjectLifecyclePort } from 'src/domains/projects';
import { Logger } from 'src/shared/logger';
import type { BackendRendererIpcStyleRegistrarPort } from 'src/app-hosts/linnya/adapters/backend-renderer-requests';
import { createWorkspaceOperationFailure } from '../workspace/workspace-operation-failure';

const logger = new Logger('ProjectIPC');

/** 项目生命周期的 Desktop 适配；Backend 组合根注入当前数据工作区的项目能力。 */
export function registerProjectHandlers(
  projects: () => ProjectLifecyclePort,
  ipc: BackendRendererIpcStyleRegistrarPort
): void {
  ipc.handle('workspace:create-project', async (_event, input: unknown) => {
    try {
      return {
        success: true,
        data: { projectId: projects().create(ProjectCreateInputSchema.parse(input)) },
      };
    } catch (error: unknown) {
      logger.error('[workspace:create-project] Failed', error);
      return createWorkspaceOperationFailure(error, 'workspace.project.operation.createFailed');
    }
  });
  ipc.handle('workspace:ensure-default-project', async () => {
    try {
      return { success: true, data: { projectId: projects().ensureDefault() } };
    } catch (error: unknown) {
      logger.error('[workspace:ensure-default-project] Failed', error);
      return createWorkspaceOperationFailure(error, 'workspace.project.operation.createFailed');
    }
  });
  ipc.handle('workspace:list-projects', async () => {
    try {
      return { success: true, data: { projects: projects().list() } };
    } catch (error: unknown) {
      logger.error('[workspace:list-projects] Failed', error);
      return createWorkspaceOperationFailure(error, 'workspace.project.operation.updateFailed');
    }
  });
  ipc.handle('workspace:update-project', async (_event, input: unknown) => {
    try {
      const { projectId, ...updates } = ProjectUpdateRequestSchema.parse(input);
      projects().update(projectId, updates);
      return { success: true };
    } catch (error: unknown) {
      logger.error('[workspace:update-project] Failed', error);
      return createWorkspaceOperationFailure(error, 'workspace.project.operation.updateFailed');
    }
  });
  ipc.handle('workspace:delete-project', async (_event, input: unknown) => {
    try {
      projects().delete(ProjectIdentityInputSchema.parse(input).projectId);
      return { success: true };
    } catch (error: unknown) {
      logger.error('[workspace:delete-project] Failed', error);
      return createWorkspaceOperationFailure(error, 'workspace.project.operation.deleteFailed');
    }
  });
}
