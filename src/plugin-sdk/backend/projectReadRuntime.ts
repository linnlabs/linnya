import type { PluginProjectReadPort } from '@linnya/plugin-host-contract/backend/projectReadRuntime';
import { createProjectLifecycle, ProjectNotFoundError } from 'src/domains/projects';
import { getDatabaseService } from 'src/electron-main/services/database';

/** 只公开现有项目 owner 的摘要读取，插件不能查询 projects 表或取得其写端口。 */
export function getPluginProjectReadPort(): PluginProjectReadPort {
  const projects = createProjectLifecycle(getDatabaseService().getDb());
  return {
    get(projectId) {
      try {
        const project = projects.get(projectId);
        return {
          id: project.id,
          name: project.name,
          description: project.description ?? undefined,
          icon: project.icon ?? undefined,
        };
      } catch (error) {
        if (error instanceof ProjectNotFoundError) return undefined;
        throw error;
      }
    },
  };
}
