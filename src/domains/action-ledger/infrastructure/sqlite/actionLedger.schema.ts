/**
 * 行动账本表。每行只存身份与引用，约 200–300 字节，不复制正文。
 *
 * 动作和执行者种类在应用层校验，不写成 CHECK：后续接入删除、移动、属性等动作时
 * 不必为改约束重建表。运行身份的完整性写成 CHECK，因为它不随动作扩展而变化。
 * 账本跟随文档删除；project_id 只标识改动发生地，不能让旧项目删除已转移文档的历史。
 */
export const ACTION_LEDGER_SCHEMAS = [
  `CREATE TABLE IF NOT EXISTS action_ledger_entries (
    id INTEGER PRIMARY KEY,
    recorded_at INTEGER NOT NULL,
    project_id TEXT NOT NULL,
    document_id TEXT NOT NULL REFERENCES workspace_nodes(id) ON DELETE CASCADE,
    document_type TEXT NOT NULL,
    action TEXT NOT NULL,
    granularity TEXT NOT NULL,
    part TEXT,
    before_ref TEXT,
    after_ref TEXT,
    summary_json TEXT,
    actor_kind TEXT NOT NULL,
    actor_plugin_id TEXT,
    author_run_id TEXT,
    conversation_id TEXT,
    run_id TEXT,
    root_run_id TEXT,
    parent_run_id TEXT,
    tool_call_id TEXT,
    agent_id TEXT,
    CHECK (actor_kind NOT IN ('run', 'subrun') OR (run_id IS NOT NULL AND root_run_id IS NOT NULL)),
    CHECK (actor_kind <> 'subrun' OR parent_run_id IS NOT NULL),
    CHECK (actor_kind <> 'plugin' OR actor_plugin_id IS NOT NULL)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_action_ledger_project_time
    ON action_ledger_entries(project_id, recorded_at)`,
  `CREATE INDEX IF NOT EXISTS idx_action_ledger_root_run
    ON action_ledger_entries(root_run_id, recorded_at) WHERE root_run_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_action_ledger_document
    ON action_ledger_entries(document_id)`,
] as const;
