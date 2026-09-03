import type {
  UiMessageDto,
  UiMessagesAnchorNotFoundDto,
  UiMessagesPreparingDto,
  UiMessagesWindowDto,
  UiMessagesWindowReadyDto,
} from '../definitions/uiMessagesDto';
import { isRecord } from '../../utils/typeGuards';
import {
  ConversationCitationDependencySnapshotSchema,
  ConversationUiMessageSchema,
} from '@app/schemas';
import {
  extractCanonicalCitationRefs,
  isConversationCitationDependencyClosure,
} from '@linnya/citation-domain/conversation-presentation';

export function readUiMessagesWindowDto(value: unknown): UiMessagesWindowDto {
  if (isUiMessagesWindowReadyDto(value)) {
    return value;
  }
  if (isUiMessagesPreparingDto(value)) {
    return value;
  }
  if (isUiMessagesAnchorNotFoundDto(value)) {
    return value;
  }
  throw new Error('ui-messages response does not match the window DTO contract');
}

function isUiMessagesWindowReadyDto(value: unknown): value is UiMessagesWindowReadyDto {
  if (!isRecord(value)) return false;
  const messages = parseUiMessages(value.messages);
  return value.success === true
    && typeof value.conversation_id === 'string'
    && messages !== null
    && isCitationDependencies(value.citation_dependencies, messages)
    && typeof value.has_more_before === 'boolean'
    && typeof value.has_more_after === 'boolean'
    && isOptionalNumber(value.prev_cursor)
    && isOptionalNumber(value.next_cursor)
    && typeof value.revision === 'number'
    && Number.isFinite(value.revision);
}

function parseUiMessages(value: unknown): readonly UiMessageDto[] | null {
  if (!Array.isArray(value)) return null;

  const messages: UiMessageDto[] = [];
  for (const message of value) {
    // Host → HTTP → Renderer 的每条 durable row 都必须通过唯一权威合同；
    // 这里不能只检查本次窗口关心的字段，否则会重新引入读取期兼容旁路。
    const parsed = ConversationUiMessageSchema.safeParse(message);
    if (!parsed.success) return null;
    messages.push(parsed.data);
  }
  return messages;
}

function isCitationDependencies(
  value: unknown,
  messages: UiMessagesWindowReadyDto['messages'],
): boolean {
  if (!isRecord(value)) return false;
  const expectedMessages = messages.flatMap(message => {
    if (message.role !== 'assistant' || message.content === null) return [];
    const refs = extractCanonicalCitationRefs(message.content);
    return refs.length === 0 ? [] : [{ messageId: message.message_id, refs }];
  });
  if (Object.keys(value).length !== expectedMessages.length) return false;

  return expectedMessages.every(({ messageId, refs }) => {
    const snapshot = ConversationCitationDependencySnapshotSchema.safeParse(value[messageId]);
    return snapshot.success
      && isConversationCitationDependencyClosure(refs, snapshot.data);
  });
}

function isUiMessagesPreparingDto(value: unknown): value is UiMessagesPreparingDto {
  return isRecord(value)
    && value.success === false
    && value.status === 'preparing'
    && typeof value.conversation_id === 'string';
}

function isUiMessagesAnchorNotFoundDto(value: unknown): value is UiMessagesAnchorNotFoundDto {
  return isRecord(value)
    && value.success === false
    && typeof value.error === 'string'
    && typeof value.conversation_id === 'string'
    && typeof value.anchor_message_id === 'string';
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}
