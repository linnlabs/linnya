import type Database from 'better-sqlite3';
import {
  ConversationClientNoticeCommandSchema,
  ConversationClientNoticePayloadSchema,
  type ConversationClientNoticePayload,
  type ConversationClientNoticeReceipt,
} from '@app/schemas';
import type {
  ConversationClientNoticeAdmissionPort,
  ConversationClientNoticeAdmissionResult,
} from 'src/features/conversation/client-notices/clientNoticeAdmission';

export interface PersistedConversationClientNotice {
  readonly conversationId: string;
  readonly acceptedAt: number;
  readonly anchorEventRowId: number;
  readonly payload: ConversationClientNoticePayload;
}

interface ClientNoticeRow {
  readonly conversation_id: string;
  readonly accepted_at: number;
  readonly anchor_event_rowid: number;
  readonly payload_json: string;
  readonly retained: 0 | 1;
}

function fromRow(row: ClientNoticeRow): PersistedConversationClientNotice {
  return {
    conversationId: row.conversation_id,
    acceptedAt: row.accepted_at,
    anchorEventRowId: row.anchor_event_rowid,
    payload: ConversationClientNoticePayloadSchema.parse(JSON.parse(row.payload_json)),
  };
}

function receipt(fact: PersistedConversationClientNotice, retained = true): ConversationClientNoticeReceipt {
  return { state: retained ? 'retained' : 'removed', conversation_id: fact.conversationId, accepted_at: fact.acceptedAt, notice: fact.payload };
}

export function readConversationClientNotices(
  db: Database.Database,
  conversationId: string,
): readonly PersistedConversationClientNotice[] {
  return db.prepare<[string], ClientNoticeRow>(`
    SELECT conversation_id, accepted_at, anchor_event_rowid, payload_json, retained
    FROM conversation_client_notices WHERE conversation_id = ? AND retained = 1
    ORDER BY anchor_event_rowid, rowid
  `).all(conversationId).map(fromRow);
}

/** fact 与 UI 投影在同一同步事务提交；重发同一 command 只返回原接纳结果。 */
export function createSqliteClientNoticeAdmission(params: {
  readonly db: Database.Database;
  readonly project: (notice: PersistedConversationClientNotice) => void;
  readonly now?: () => number;
}): ConversationClientNoticeAdmissionPort {
  const { db } = params;
  return {
    accept(conversationId, input): ConversationClientNoticeAdmissionResult {
      const command = ConversationClientNoticeCommandSchema.parse(input);
      const payload = ConversationClientNoticePayloadSchema.parse({ ...command, origin: 'client' });
      const encoded = JSON.stringify(payload);
      return db.transaction((): ConversationClientNoticeAdmissionResult => {
        const exists = db.prepare<[string], { found: number }>(
          'SELECT 1 AS found FROM conversations WHERE conversation_id = ?'
        ).get(conversationId);
        if (!exists) return { status: 'conversation-not-found' };
        const old = db.prepare<[string], ClientNoticeRow>(`
          SELECT conversation_id, accepted_at, anchor_event_rowid, payload_json, retained
          FROM conversation_client_notices WHERE notice_id = ?
        `).get(command.notice_id);
        if (old) {
          const previous = fromRow(old);
          if (old.conversation_id !== conversationId || JSON.stringify(previous.payload) !== encoded) {
            return { status: 'identity-conflict' };
          }
          return { status: 'accepted', receipt: receipt(previous, old.retained === 1) };
        }
        const anchor = db.prepare<[string], { last_rowid: number }>(`
          SELECT COALESCE(MAX(e.rowid), 0) AS last_rowid FROM events e
          JOIN runs r ON r.id = e.run_id WHERE r.conversation_id = ?
        `).get(conversationId);
        if (!anchor) throw new Error('Client notice anchor query returned no row');
        const fact: PersistedConversationClientNotice = {
          conversationId, acceptedAt: (params.now ?? Date.now)(),
          anchorEventRowId: anchor.last_rowid, payload,
        };
        db.prepare(`
          INSERT INTO conversation_client_notices
            (notice_id, conversation_id, observed_at, accepted_at, anchor_event_rowid, payload_json)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(command.notice_id, conversationId, command.observed_at, fact.acceptedAt, fact.anchorEventRowId, encoded);
        params.project(fact);
        return { status: 'accepted', receipt: receipt(fact) };
      }).immediate();
    },
  };
}
