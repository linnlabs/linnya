export const COMMAND_CARD_SETTLEMENT_SCHEMAS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS conversation_command_card_settlements (
    conversation_id      TEXT    NOT NULL,
    process_handle       TEXT    NOT NULL,
    command_execution_id TEXT    NOT NULL,
    agent_run_id         TEXT    NOT NULL,
    owner_generation_id  TEXT    NOT NULL,
    started_at_ms        INTEGER NOT NULL CHECK(started_at_ms >= 0),
    settled_at_ms        INTEGER NOT NULL CHECK(settled_at_ms >= started_at_ms),
    audit_status         TEXT    NOT NULL DEFAULT 'complete'
                                 CHECK(audit_status IN ('complete', 'incomplete')),
    terminal_json        TEXT    NOT NULL,
    PRIMARY KEY(conversation_id, process_handle),
    FOREIGN KEY(conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE
  );
  `,
];
