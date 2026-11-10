import { z } from 'zod';

interface ConversationProjectReadDatabase { prepare(sql: string): unknown }
interface ConversationProjectStatement { get(...parameters: readonly unknown[]): unknown }
function isConversationProjectStatement(value: unknown): value is ConversationProjectStatement {
  return typeof value === 'object' && value !== null && 'get' in value && typeof value.get === 'function';
}

/** 归属只读正式 conversation 列，不从消息、metadata 或当前界面猜项目。 */
export function readConversationProjectId(database: ConversationProjectReadDatabase, conversationId: string): string | null {
  const statement = database.prepare('SELECT project_id FROM conversations WHERE conversation_id = ?');
  if (!isConversationProjectStatement(statement)) throw new Error('Conversation projection requires a readable statement');
  const raw = statement.get(conversationId);
  return raw === undefined ? null : z.object({ project_id: z.string().nullable() }).parse(raw).project_id;
}
