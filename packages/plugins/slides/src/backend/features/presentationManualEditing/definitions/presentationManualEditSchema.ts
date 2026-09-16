export const PRESENTATION_MANUAL_EDIT_SCHEMAS = [
  `CREATE TABLE IF NOT EXISTS presentation_manual_edit_receipts (
    command_id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL,
    payload_digest TEXT NOT NULL,
    revision_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    created_at INTEGER NOT NULL,

    FOREIGN KEY (node_id) REFERENCES presentation_documents(node_id) ON DELETE CASCADE,
    FOREIGN KEY (revision_id) REFERENCES presentation_revisions(id) ON DELETE CASCADE,
    UNIQUE (node_id, revision)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_presentation_manual_edit_receipts_node_created
    ON presentation_manual_edit_receipts(node_id, created_at DESC)`,
] as const;
