/**
 * 这里只保存可重复匹配的简单命令批准，不保存 pending 审批或完整命令文本。
 * 每条记录以审批请求为独立身份，便于 owner 结束时只撤回自己的迟到写入；匹配时仍同时
 * 使用对话、平台、Shell 语义、matcher 版本、批准时工作目录和用户看见的 token
 * 前缀，避免相对路径在另一目录里指向不同目标。
 */
export const COMMAND_APPROVAL_SCHEMAS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS conversation_command_approvals (
    approval_request_id TEXT    PRIMARY KEY,
    conversation_id    TEXT    NOT NULL,
    platform           TEXT    NOT NULL CHECK(platform IN ('macos', 'windows')),
    shell_semantics_id TEXT    NOT NULL,
    matcher_revision   TEXT    NOT NULL,
    token_prefix_json  TEXT    NOT NULL,
    approved_cwd       TEXT    NOT NULL CHECK(length(trim(approved_cwd)) > 0),
    approved_at_ms     INTEGER NOT NULL CHECK(approved_at_ms >= 0),
    FOREIGN KEY(conversation_id)
      REFERENCES conversations(conversation_id)
      ON DELETE CASCADE
  );
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_conversation_command_approvals_lookup
  ON conversation_command_approvals (
    conversation_id,
    platform,
    shell_semantics_id,
    matcher_revision,
    approved_at_ms,
    approval_request_id
  );
  `,
];
