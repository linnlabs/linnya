import type Database from 'better-sqlite3';

/**
 * 旧 citation sidecar 使用搜索展示合同，已经丢失作者数组和刊名，不能按新合同猜补。
 * 只清理可重建索引并标记 pending；完整字段由正式 projector 从原始工具事实重新接纳。
 * Runtime events、Subrun trace 及文档中的引用快照都不是本迁移的写入对象。
 */
export function migrateV66ToV67ConversationCitationMetadata(db: Database.Database): void {
  db.exec('DELETE FROM conversation_ui_citation_facts');
  db.prepare("UPDATE conversation_ui_projection_state SET status = 'pending'").run();
}
