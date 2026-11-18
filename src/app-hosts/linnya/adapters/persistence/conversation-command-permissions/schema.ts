export const CONVERSATION_COMMAND_PERMISSION_SCHEMAS = [
  `CREATE TABLE IF NOT EXISTS conversation_command_permissions (
    conversation_id TEXT PRIMARY KEY REFERENCES conversations(conversation_id) ON DELETE CASCADE,
    permission_level TEXT CHECK (permission_level IN ('read_only', 'standard', 'full_access')),
    revision INTEGER NOT NULL CHECK (revision > 0)
  )`,
  // anchor_event_rowid：改档位时对话最后一个事件的位置，重建时间线时把记录放回原处。
  `CREATE TABLE IF NOT EXISTS conversation_command_permission_changes (
    conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    anchor_event_rowid INTEGER NOT NULL,
    fact TEXT NOT NULL,
    PRIMARY KEY (conversation_id, revision)
  )`,
  `CREATE TABLE IF NOT EXISTS conversation_run_command_permissions (
    run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE,
    captured_at_ms INTEGER NOT NULL,
    permission_level TEXT CHECK (permission_level IN ('read_only', 'standard', 'full_access')),
    source TEXT CHECK (source IN ('global_setting', 'conversation_setting')),
    CHECK ((permission_level IS NULL) = (source IS NULL))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_conversation_run_command_permissions_history
    ON conversation_run_command_permissions (conversation_id, captured_at_ms DESC, run_id DESC)`,
  `CREATE TABLE IF NOT EXISTS pending_command_permission_reduction (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    update_json TEXT NOT NULL,
    changed_count INTEGER NOT NULL
  )`,
];
