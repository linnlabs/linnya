import type Database from 'better-sqlite3';
import type { ProjectLifecyclePort } from '../../../../../domains/projects';
import type { ProjectDeletionCatalogPort } from '../../../application/project-deletion';

/** 读取会话 owner 的正式归属；项目仍由 Project lifecycle 删除。 */
export function createSqliteProjectDeletionCatalog(
  db: Database.Database,
  projects: ProjectLifecyclePort
): ProjectDeletionCatalogPort {
  const list = db.prepare<[string], { conversation_id: string }>(
    'SELECT conversation_id FROM conversations WHERE project_id = ? ORDER BY created_at, conversation_id'
  );
  const commit = db.transaction((projectId: string) => {
    // 清理运行需要 await；期间若新建了会话，不能让 SET NULL 将其悄悄移出项目。
    if (list.get(projectId))
      throw new Error('Project gained a conversation during deletion; retry required');
    projects.delete(projectId);
  });
  const begin = db.transaction((projectId: string) => {
    db.prepare(
      `INSERT OR IGNORE INTO project_deletion_conversations (project_id, conversation_id)
      SELECT project_id, conversation_id FROM conversations WHERE project_id = ?`
    ).run(projectId);
    return db
      .prepare<[string], { conversation_id: string }>(
        'SELECT conversation_id FROM project_deletion_conversations WHERE project_id = ? ORDER BY conversation_id'
      )
      .all(projectId)
      .map(row => row.conversation_id);
  });
  return {
    getProject: projectId => projects.get(projectId),
    beginDeletion: begin,
    commitDeletion: commit,
  };
}
