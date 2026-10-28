import type { ProjectCreateInput, ProjectRecord, ProjectUpdateInput } from '@app/schemas';

export const DEFAULT_PROJECT_SYSTEM_ROLE = 'default';
export const DEFAULT_PROJECT_NAME = '默认项目';
export const DEFAULT_PROJECT_DESCRIPTION = '您的第一个项目';

/** 查询与修改的是项目记录，不改变数据工作区、Backend 或当前界面导航。 */
export interface ProjectLifecyclePort {
  create(input: ProjectCreateInput): string;
  ensureDefault(): string;
  get(projectId: string): ProjectRecord;
  list(): ProjectRecord[];
  update(projectId: string, input: ProjectUpdateInput): void;
  delete(projectId: string): void;
}
