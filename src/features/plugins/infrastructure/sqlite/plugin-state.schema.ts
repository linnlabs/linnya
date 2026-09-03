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

export const PLUGIN_PLATFORM_STATE_SCHEMAS = [
  PLUGIN_INSTALLATION_STATE_SCHEMA,
  PLUGIN_ACTIVE_VERSION_SCHEMA,
];
