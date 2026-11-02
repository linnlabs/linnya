import type { ProjectRecord } from '@app/schemas';

export interface ProjectDeletionUseCasePort {
  requestDeletion(projectId: string): Promise<void>;
}

/** 项目记录与会话归属的同步提交边界，不向用例暴露数据库。 */
export interface ProjectDeletionCatalogPort {
  getProject(projectId: string): ProjectRecord;
  /** 持久记录本次删除范围，重试也包含已删事实、但清理 job 尚未完成的会话。 */
  beginDeletion(projectId: string): readonly string[];
  /** 同一事务中确认已无项目会话，再删除项目记录和其级联数据。 */
  commitDeletion(projectId: string): void;
}

export class ProjectDeletionIncompleteError extends Error {
  constructor(
    readonly projectId: string,
    readonly cause: unknown
  ) {
    super('Project deletion did not complete; some content may already have been removed');
    this.name = 'ProjectDeletionIncompleteError';
  }
}
