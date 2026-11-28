import type Database from 'better-sqlite3';
import { ConversationExternalSenderSchema, type ConversationExternalSender } from '@app/schemas';
import { RUN_EXTERNAL_SENDER_METADATA_KEY } from 'src/domains/action-ledger';

/**
 * 读运行登记时记下的外部发件人（对话流程在接纳外部入口的请求时写入运行元数据）。
 * 用户在界面里发起的运行没有这一项，返回 null。
 */
export function createRunExternalSenderReader(db: Database.Database): (runId: string) => ConversationExternalSender | null {
  const select = db.prepare<[string], { sender: string | null }>(
    `SELECT json_extract(metadata_json, '$.${RUN_EXTERNAL_SENDER_METADATA_KEY}') AS sender FROM runs WHERE id = ?`,
  );
  return runId => {
    const sender = select.get(runId)?.sender;
    return sender ? ConversationExternalSenderSchema.parse(JSON.parse(sender)) : null;
  };
}
