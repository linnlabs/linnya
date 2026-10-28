import type Database from 'better-sqlite3';
import { ProjectNotFoundError } from '../../../definitions/projectErrors';

/** 文档树只需验证项目身份，无需读取或解释项目表内部字段。 */
export function assertProjectExists(db: Database.Database, projectId: string): void {
  const project: unknown = db
    .prepare('SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL')
    .get(projectId);
  if (!project) throw new ProjectNotFoundError(projectId);
}
