import { ProjectOverviewSchema, type ProjectOverview, type ProjectOverviewRequest } from '@app/schemas';

/** 项目概览的 Backend 读取；返回值在这里按共享合同解析，调用方拿到的一定合法。 */
export async function readProjectOverview(request: ProjectOverviewRequest): Promise<ProjectOverview> {
  const response = await window.electronAPI.readProjectOverview(request);
  return ProjectOverviewSchema.parse(response);
}
