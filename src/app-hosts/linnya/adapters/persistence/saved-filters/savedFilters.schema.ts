/**
 * 项目概览“保存的筛选”。界面配置，不是用户内容：不进文档版本和行动账本。
 * 项目物理删除时随之删除；来源对话删除后只清空 conversation_id。
 */
export const PROJECT_SAVED_FILTER_SCHEMAS = [
  `CREATE TABLE IF NOT EXISTS project_saved_filters (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    origin TEXT NOT NULL CHECK (origin IN ('user', 'agent')),
    pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
    position INTEGER NOT NULL,
    conversation_id TEXT REFERENCES conversations(conversation_id) ON DELETE SET NULL,
    definition_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_opened_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_project_saved_filters_project
    ON project_saved_filters(project_id, pinned, position)`,
];
