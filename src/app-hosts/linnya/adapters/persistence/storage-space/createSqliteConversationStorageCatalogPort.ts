import type Database from 'better-sqlite3';

import {
  ConversationStorageCatalogItemSchema,
  type ConversationStorageCatalogItem,
  type ConversationStorageCatalogPort,
} from '../../../application/storage-space';

interface ConversationStorageCatalogRow {
  readonly conversation_id: unknown;
  readonly title: unknown;
  readonly last_event_at: unknown;
  readonly project_id: unknown;
}

function projectCatalogItem(
  row: ConversationStorageCatalogRow,
): ConversationStorageCatalogItem {
  return Object.freeze(ConversationStorageCatalogItemSchema.parse({
    conversationId: row.conversation_id,
    title: row.title,
    lastEventAt: row.last_event_at,
    projectId: row.project_id,
  }));
}

/**
 * 存储空间是全局设置，因此这里有意不复用 History 的 project filter 和 pinned 排序。
 * 同毫秒的 conversationId 次序固定，保证重复读取不会让清理按钮跳到另一行。
 */
export function createSqliteConversationStorageCatalogPort(
  db: Database.Database,
): ConversationStorageCatalogPort {
  const listAllStatement = db.prepare<[], ConversationStorageCatalogRow>(`
    SELECT
      conversation_id,
      title,
      last_event_at,
      project_id
    FROM conversations
    ORDER BY last_event_at DESC, conversation_id DESC
  `);

  return Object.freeze({
    listAll(): readonly ConversationStorageCatalogItem[] {
      return Object.freeze(listAllStatement.all().map(projectCatalogItem));
    },
  });
}
