export const PLUGIN_INSTALLATION_STATE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS installed_plugins (
    plugin_id      TEXT PRIMARY KEY,
    version        TEXT NOT NULL,
    name           TEXT NOT NULL DEFAULT '',
    installed      INTEGER NOT NULL DEFAULT 1,
    builtin        INTEGER NOT NULL DEFAULT 0,
    required       INTEGER NOT NULL DEFAULT 0,
    installed_at   INTEGER NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 0,
    compat_min     TEXT,
    source         TEXT NOT NULL DEFAULT 'builtin',
    user_removed   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS enabled_plugins (
    plugin_id  TEXT PRIMARY KEY,
    enabled_at INTEGER NOT NULL,
    FOREIGN KEY(plugin_id) REFERENCES installed_plugins(plugin_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS plugin_migrations (
    plugin_id  TEXT NOT NULL,
    version    INTEGER NOT NULL,
    applied_at INTEGER NOT NULL,
    PRIMARY KEY (plugin_id, version)
  );
`;

export const PLUGIN_ACTIVE_VERSION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS plugin_active_versions (
    plugin_id        TEXT PRIMARY KEY,
    active_version   TEXT NOT NULL,
    previous_version TEXT,
    status           TEXT NOT NULL DEFAULT 'active'
      CHECK(status IN ('activating', 'active', 'failed')),
    error            TEXT,
    updated_at       INTEGER NOT NULL,
    FOREIGN KEY(plugin_id) REFERENCES installed_plugins(plugin_id) ON DELETE CASCADE
  );
`;

/** Host 只记录清理意图与进度，实际目录由 manifest 声明，便于中断后续清。 */
export const PLUGIN_CLEANUP_SCHEMA = `
  CREATE TABLE IF NOT EXISTS plugin_cleanup_jobs (
    plugin_id       TEXT PRIMARY KEY,
    status          TEXT NOT NULL CHECK(status IN ('cleaning', 'failed')),
    completed_paths TEXT NOT NULL DEFAULT '[]',
    data_storage    TEXT NOT NULL DEFAULT '{}',
    error           TEXT,
    error_code      TEXT,
    started_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    FOREIGN KEY(plugin_id) REFERENCES installed_plugins(plugin_id) ON DELETE CASCADE
  );
`;

export const PLUGIN_PLATFORM_STATE_SCHEMAS = [
  PLUGIN_INSTALLATION_STATE_SCHEMA,
  PLUGIN_ACTIVE_VERSION_SCHEMA,
  PLUGIN_CLEANUP_SCHEMA,
  `CREATE TABLE IF NOT EXISTS plugin_purged_citation_sources (
    source_slot TEXT NOT NULL,
    source_id   TEXT NOT NULL,
    PRIMARY KEY (source_slot, source_id)
  ) WITHOUT ROWID;`,
];
