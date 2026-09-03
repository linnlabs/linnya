/**
 * @file todo.schema.ts
 * @description Defines the database schema for the Todo feature.
 */

export const TODO_SCHEMAS = [
  // Todos table, linked to a project
  `CREATE TABLE IF NOT EXISTS todos (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL,
    priority TEXT,
    custom_tags_json TEXT,
    due_date TEXT,
    due_time TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`,

  // Indexes for performance
  `CREATE INDEX IF NOT EXISTS idx_todos_project ON todos(project_id, deleted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status, deleted_at)`,
];
