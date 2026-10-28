/** 项目记录属于 Project；表名保持稳定，不迁移已有数据。 */
export const PROJECT_SCHEMAS = [
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

  `CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_active_system_role_unique
    ON projects(system_role)
    WHERE deleted_at IS NULL AND system_role IS NOT NULL`,
];
