/**
 * @file src/app-hosts/linnya/adapters/persistence/event-store/conversation.schema.ts
 * @description 定义 Linnya backend conversation event-store 的表结构。
 *
 * 核心设计：
 * 1. conversations: 对话的元数据
 * 2. runs: 记录一次完整的交互"轮次"
 * 3. events: 仅追加的、不可变的"事实源"
 * 4. conversation_ui_messages / conversation_ui_citation_facts: 可重建的前端历史窗口 read model
 */

export const CONVERSATION_SCHEMAS = [
  // 对话表
  // 注意：保留所有原有字段，只新增 project_id（可选）以支持项目关联
  `CREATE TABLE IF NOT EXISTS conversations (
    conversation_id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'New Chat',
    created_at INTEGER NOT NULL,
    last_event_at INTEGER NOT NULL,
    preview_text TEXT,
    total_events INTEGER NOT NULL DEFAULT 0,
    user_message_count INTEGER NOT NULL DEFAULT 0,
    is_pinned INTEGER NOT NULL DEFAULT 0,
    pinned_at INTEGER,
    metadata TEXT,
    project_id TEXT,
    selected_agent_id TEXT,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL
  )`,

  // run 事实表。kind 的活协议是 user_input | agent，权威定义见 persistence/definitions/conversationRunKind.ts。
  `CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    parent_run_id TEXT,
    agent_spec_id TEXT,
    current_node TEXT,
    model_key TEXT,
    toolset_version TEXT,
    start_ts INTEGER NOT NULL,
    updated_ts INTEGER,
    end_ts INTEGER,
    paused_ts INTEGER,
    pause_reason TEXT,
    iterations_used INTEGER,
    iteration_budget_json TEXT,
    error_json TEXT,
    metadata_json TEXT,
    FOREIGN KEY(conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE
  )`,

  // 事件表（事实源）。身份由窄列/runs 关系持有，payload 只保存事件专属 body。
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    ts INTEGER NOT NULL,
    event_store_id TEXT,
    FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
  )`,

  // Child 实时过程的紧凑历史绑定；不复制 child lifecycle 状态机。
  `CREATE TABLE IF NOT EXISTS subrun_trace_runs (
    subrun_id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    parent_run_id TEXT,
    parent_tool_call_id TEXT NOT NULL,
    subrun_parent_id TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE
  )`,

  // 只保存 thought/tool terminal/final answer/summary 等语义项，不保存逐 chunk RuntimeEvent envelope。
  `CREATE TABLE IF NOT EXISTS subrun_trace_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subrun_id TEXT NOT NULL,
    source_event_id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK(kind IN ('thought_complete', 'tool_call_decision', 'tool_output', 'final_answer', 'history_summary')),
    timestamp INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    FOREIGN KEY(subrun_id) REFERENCES subrun_trace_runs(subrun_id) ON DELETE CASCADE
  )`,

  // 会话 UI read model：按前端渲染窗口查询优化的消息投影。
  `CREATE TABLE IF NOT EXISTS conversation_ui_messages (
    message_id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    role TEXT NOT NULL,
    message_type TEXT NOT NULL,
    sort_seq INTEGER NOT NULL,
    timestamp INTEGER NOT NULL,
    content TEXT,
    attachments_json TEXT,
    payload_json TEXT,
    merge_key TEXT,
    presentation TEXT,
    run_id TEXT NOT NULL,
    FOREIGN KEY(conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE
  )`,

  // 会话 UI read model 的重建状态。API 只对 ready 会话开放窗口化读取。
  `CREATE TABLE IF NOT EXISTS conversation_ui_projection_state (
    conversation_id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK(status IN ('pending', 'ready')),
    revision INTEGER NOT NULL DEFAULT 0,
    last_event_rowid INTEGER NOT NULL DEFAULT 0,
    rebuilt_at INTEGER,
    FOREIGN KEY(conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE
  )`,

  // Conversation UI 引用事实索引：从 durable tool/subrun facts 重建，避免窗口读取重扫完整历史。
  `CREATE TABLE IF NOT EXISTS conversation_ui_citation_facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    ref TEXT NOT NULL,
    available_sort_seq INTEGER NOT NULL CHECK(available_sort_seq > 0),
    timestamp INTEGER NOT NULL,
    producer_kind TEXT NOT NULL CHECK(producer_kind IN ('main_tool', 'subrun_tool')),
    producer_id TEXT NOT NULL,
    owner_run_id TEXT NOT NULL,
    citation_ordinal INTEGER NOT NULL CHECK(citation_ordinal >= 0),
    citation_json TEXT NOT NULL,
    UNIQUE(producer_kind, producer_id, citation_ordinal),
    FOREIGN KEY(conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE
  )`,

  // immutable event 与 workspace asset 的有序引用事实。
  `CREATE TABLE IF NOT EXISTS conversation_event_asset_links (
    conversation_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    attachment_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
    asset_id TEXT NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('user_input', 'tool_output')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY(event_id, attachment_id),
    UNIQUE(event_id, ordinal),
    FOREIGN KEY(conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE,
    FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE RESTRICT
  )`,

  // 索引优化
  `CREATE INDEX IF NOT EXISTS idx_conversations_last_event ON conversations(last_event_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_conversations_pinned ON conversations(is_pinned DESC, pinned_at DESC, last_event_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_runs_conversation_id ON runs(conversation_id)`,
  `CREATE INDEX IF NOT EXISTS idx_runs_parent_run_id ON runs(parent_run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_runs_agent_spec_id ON runs(agent_spec_id)`,
  `CREATE INDEX IF NOT EXISTS idx_runs_status_start_ts ON runs(status, start_ts DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_events_run_id ON events(run_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_events_event_store_id_unique ON events(event_store_id) WHERE event_store_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_subrun_trace_runs_parent
    ON subrun_trace_runs(conversation_id, parent_tool_call_id, subrun_id)`,
  `CREATE INDEX IF NOT EXISTS idx_subrun_trace_runs_parent_run
    ON subrun_trace_runs(parent_run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_subrun_trace_items_subrun_order
    ON subrun_trace_items(subrun_id, id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_ui_messages_conv_sort_seq_unique ON conversation_ui_messages(conversation_id, sort_seq)`,
  `CREATE INDEX IF NOT EXISTS idx_conversation_ui_messages_conv_merge_key ON conversation_ui_messages(conversation_id, merge_key)`,
  `CREATE INDEX IF NOT EXISTS idx_conversation_ui_messages_conv_run_id ON conversation_ui_messages(conversation_id, run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_conversation_ui_messages_conv_message_type ON conversation_ui_messages(conversation_id, message_type)`,
  `CREATE INDEX IF NOT EXISTS idx_conversation_ui_citation_facts_lookup
    ON conversation_ui_citation_facts(conversation_id, ref, available_sort_seq)`,
  `CREATE INDEX IF NOT EXISTS idx_conversation_ui_citation_facts_scope
    ON conversation_ui_citation_facts(conversation_id, scope_id, ref)`,
  `CREATE INDEX IF NOT EXISTS idx_conversation_ui_citation_facts_owner_run
    ON conversation_ui_citation_facts(conversation_id, owner_run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_conversation_event_asset_links_asset ON conversation_event_asset_links(asset_id)`,
  `CREATE INDEX IF NOT EXISTS idx_conversation_event_asset_links_conversation_event_ordinal
    ON conversation_event_asset_links(conversation_id, event_id, ordinal)`,
];
