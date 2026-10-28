import {
  ProjectCreatedResponseSchema,
  ProjectListResponseSchema,
  ProjectMutationResponseSchema,
  type ProjectCreateInput,
  type ProjectUpdateRequest,
} from '@app/schemas';

/** workspace:* 是现有 IPC 地址。业务入口按 Project 命名，不通过通用 Workspace 网关解释项目。 */
async function invoke(channel: string, input?: unknown): Promise<unknown> {
  if (!window.electronAPI) throw new Error('Project IPC is unavailable');
  return window.electronAPI.invoke(channel, input);
}

export const projectGateway = {
  async create(input: ProjectCreateInput) {
    return ProjectCreatedResponseSchema.parse(await invoke('workspace:create-project', input));
  },
  async ensureDefault() {
    return ProjectCreatedResponseSchema.parse(await invoke('workspace:ensure-default-project'));
  },
  async list() {
    return ProjectListResponseSchema.parse(await invoke('workspace:list-projects'));
  },
  async update(input: ProjectUpdateRequest) {
    return ProjectMutationResponseSchema.parse(await invoke('workspace:update-project', input));
  },
  async delete(projectId: string) {
    return ProjectMutationResponseSchema.parse(
      await invoke('workspace:delete-project', { projectId })
    );
  },
};
