import { z } from 'zod';
import { ConversationWorkDirectoryConversationIdSchema } from '../../../../../domains/conversation-files';

export const ConversationStorageCatalogItemSchema = z.object({
  conversationId: ConversationWorkDirectoryConversationIdSchema,
  title: z.string(),
  lastEventAt: z.number().int().nonnegative().safe(),
  projectId: z.string().nullable(),
}).strict();

export type ConversationStorageCatalogItem = Readonly<z.infer<
  typeof ConversationStorageCatalogItemSchema
>>;

/**
 * 存储空间读取全部对话身份和名称，不沿用 History 当前项目、搜索或分页条件。
 * 该端口只提供计量所需目录，不暴露 EventStore、事件或删除能力。
 */
export interface ConversationStorageCatalogPort {
  listAll(): readonly ConversationStorageCatalogItem[];
}
