import type { RuntimeEvent } from 'linnkit/contracts';
import type {
  ConversationUiMessage,
  ConversationUiMessageRole,
  ConversationUiPresentation,
  ConversationTimelineMessageType,
} from '@app/schemas';
import type { UiMessageAttachments } from './attachments';

export type UiProjectionStatus = 'loading' | 'success' | 'error';

/**
 * Host 投影器允许写入 SQLite 的 payload 联合。
 *
 * 它直接从公共 DTO 合同派生，禁止恢复成开放 JSON record。存储层可以把它序列化为 JSON，
 * 但任何 producer 都必须先证明 payload 与 messageType 匹配。
 */
export type UiMessagePayload = Exclude<ConversationUiMessage['payload'], null>;

export type UiMessageRole = ConversationUiMessageRole;
export type UiMessageType = ConversationTimelineMessageType;

interface UiMessageRowFields<Payload extends ConversationUiMessage['payload']> {
  readonly messageId: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly timestamp: number;
  readonly content: string | null;
  readonly attachments: UiMessageAttachments | null;
  readonly payload: Payload;
  readonly mergeKey: string | null;
  readonly presentation: ConversationUiPresentation | null;
  readonly runId: string;
}

type UiMessageRowVariant<Message extends ConversationUiMessage> =
  UiMessageRowFields<Message['payload']> & {
    readonly role: Message['role'];
    readonly messageType: Message['message_type'];
  };

/** role、messageType 与 payload 保持关联的 Host 内部判别联合。 */
export type NewUiMessageRow = ConversationUiMessage extends infer Message
  ? Message extends ConversationUiMessage
    ? UiMessageRowVariant<Message>
    : never
  : never;

type StripRuntimeRowFields<Row> = Row extends NewUiMessageRow
  ? Omit<Row, 'conversationId' | 'turnId' | 'timestamp' | 'runId' | 'attachments'> & {
    readonly attachments?: UiMessageAttachments | null;
  }
  : never;

/** projectEvent 的唯一 row constructor 输入，仍保留 messageType/payload 判别关系。 */
export type NewUiMessageRowInput = StripRuntimeRowFields<NewUiMessageRow>;

export type UiMessageRow = NewUiMessageRow & {
  readonly sortSeq: number;
};

export interface UiProjectionReadAccess {
  getRowByMergeKey(conversationId: string, mergeKey: string): UiMessageRow | null;
  getRowByMessageId(conversationId: string, messageId: string): UiMessageRow | null;
}

export type UiRowOp =
  | { readonly op: 'insert'; readonly row: NewUiMessageRow }
  | { readonly op: 'replace'; readonly row: UiMessageRow }
  | { readonly op: 'hide'; readonly messageIds: readonly string[] }
  | { readonly op: 'skip'; readonly eventType: RuntimeEvent['type']; readonly eventId: string; readonly reason: string };
