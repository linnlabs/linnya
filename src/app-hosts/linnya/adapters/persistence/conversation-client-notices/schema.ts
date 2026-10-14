/** UI 客户端故障有独立产品事实真源，不用伪 run 满足 RuntimeEvent 身份。 */
export const CONVERSATION_CLIENT_NOTICE_SCHEMA = `CREATE TABLE IF NOT EXISTS conversation_client_notices (
  notice_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  accepted_at INTEGER NOT NULL,
  anchor_event_rowid INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  retained INTEGER NOT NULL DEFAULT 1 CHECK (retained IN (0, 1)),
  FOREIGN KEY(conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE
)`;
