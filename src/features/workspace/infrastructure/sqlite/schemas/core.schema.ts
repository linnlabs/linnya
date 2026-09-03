/**
 * @file core.schema.ts
 * @description 定义工作区的核心结构：项目和工作区节点树。
 * 
 * 这两个表是整个应用数据组织的基础：
 * - projects: 顶层容器，类似于 IDE 的"项目"概念
 * - workspace_nodes: 统一的文件/文件夹树，支持多种内容类型
 */

export const CORE_SCHEMAS = [
  // 项目表 (顶层容器)
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    icon TEXT,
    system_role TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    metadata_json TEXT,
    deleted_at INTEGER
  )`,

  // 统一的工作区节点表 (项目中的导航树)
  `CREATE TABLE IF NOT EXISTS workspace_nodes (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    parent_id TEXT,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    icon TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    -- Intelligence and personalization fields
    last_opened_at INTEGER,
    access_count INTEGER NOT NULL DEFAULT 0,
    tags TEXT,
    UNIQUE(project_id, parent_id, name, deleted_at),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(parent_id) REFERENCES workspace_nodes(id) ON DELETE CASCADE
  )`,

  // 索引优化
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_active_system_role_unique
    ON projects(system_role)
    WHERE deleted_at IS NULL AND system_role IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_workspace_nodes_project ON workspace_nodes(project_id, deleted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_workspace_nodes_parent ON workspace_nodes(parent_id, deleted_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_nodes_active_sibling_name_unique
    ON workspace_nodes(
      COALESCE(project_id, '__global__'),
      COALESCE(parent_id, '__root__'),
      name
    )
    WHERE deleted_at IS NULL`,
];
