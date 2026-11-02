import type { ISchemaProvider } from 'src/shared/database/schema-provider';

export const PROJECT_DELETION_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS project_deletion_conversations (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL,
    PRIMARY KEY(project_id, conversation_id)
  )`,
];

/** 不能给 conversation_id 加级联 FK：事实删除后仍需记住尚未完成的文件/任务收尾。 */
export function getProjectDeletionSchemaProviders(): ISchemaProvider[] {
  return [{ name: 'project_deletion_conversations', getSchema: () => PROJECT_DELETION_SCHEMA }];
}
