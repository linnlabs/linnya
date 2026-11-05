/**
 * Asset 账本及其稳定归属关系的权威建表定义。
 *
 * 这些表历史上与 Markdown 文档表共同定义，但 asset 身份并不从属于某一种
 * 文档类型。表名与外键保持不变，本文件只收紧代码所有权，不迁移用户数据。
 */
/**
 * `assets.local_path` 只能是相对 AppData Root 的持久路径（见 asset-storage-path）：
 * 非空，只含字母、数字、`.`、`_`、`-`、`/`，没有空段、`.` 段或 `..` 段。
 * 遗漏转换的写入在触发器处失败，读取与回收不会按绝对路径比对而误判文件归属。
 */
const INVALID_LOCAL_PATH = `NEW.local_path IS NOT NULL AND (
    NEW.local_path = ''
    OR NEW.local_path GLOB '*[^A-Za-z0-9._/-]*'
    OR ('/' || NEW.local_path || '/') GLOB '*//*'
    OR ('/' || NEW.local_path || '/') GLOB '*/./*'
    OR ('/' || NEW.local_path || '/') GLOB '*/../*'
  )`;

export const ASSET_LEDGER_SCHEMAS = [
  `CREATE TABLE IF NOT EXISTS asset_storage_bindings (
    storage_kind TEXT PRIMARY KEY,
    storage_id TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    uri TEXT NOT NULL UNIQUE,
    media_type TEXT,
    size_bytes INTEGER,
    width_px INTEGER,
    height_px INTEGER,
    sha256 TEXT,
    storage_status TEXT NOT NULL,
    local_path TEXT,
    created_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS document_asset_links (
    document_node_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    usage_hint TEXT,
    PRIMARY KEY(document_node_id, asset_id),
    FOREIGN KEY(document_node_id) REFERENCES workspace_nodes(id) ON DELETE CASCADE,
    FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE RESTRICT
  )`,

  `CREATE TABLE IF NOT EXISTS project_asset_links (
    project_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'resource',
    origin TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY(project_id, asset_id),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE RESTRICT
  )`,

  `CREATE TRIGGER IF NOT EXISTS assets_local_path_relative_insert
  BEFORE INSERT ON assets
  WHEN ${INVALID_LOCAL_PATH}
  BEGIN
    SELECT RAISE(ABORT, 'assets.local_path must be a path relative to the AppData root');
  END`,

  `CREATE TRIGGER IF NOT EXISTS assets_local_path_relative_update
  BEFORE UPDATE OF local_path ON assets
  WHEN ${INVALID_LOCAL_PATH}
  BEGIN
    SELECT RAISE(ABORT, 'assets.local_path must be a path relative to the AppData root');
  END`,

  `CREATE INDEX IF NOT EXISTS idx_assets_uri ON assets(uri)`,
  `CREATE INDEX IF NOT EXISTS idx_project_asset_links_asset ON project_asset_links(asset_id)`,
];
