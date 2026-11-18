import type Database from 'better-sqlite3';

/** v78 的运行描述符只可能由全局档位生成。恢复继续使用已冻结的旧档。 */
export function migrateV78ToV79ConversationCommandPermissions(db: Database.Database): void {
  const hasDescriptors = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'agent_run_descriptors'",
  ).get();
  if (!hasDescriptors) return;
  db.exec(`
    UPDATE agent_run_descriptors
    SET descriptor_json = json_set(
      descriptor_json,
      '$.commandPermission.snapshot.source', 'global_setting',
      '$.commandPermission.snapshot.conversation_revision', 0
    )
    WHERE CASE WHEN json_valid(descriptor_json) THEN
      json_extract(descriptor_json, '$.schemaVersion') = 1
      AND json_extract(descriptor_json, '$.commandPermission.status') = 'available'
      AND json_type(descriptor_json, '$.commandPermission.snapshot') = 'object'
      AND json_type(descriptor_json, '$.commandPermission.snapshot.source') IS NULL
      AND json_type(descriptor_json, '$.commandPermission.snapshot.conversation_revision') IS NULL
    ELSE 0 END
  `);
}
