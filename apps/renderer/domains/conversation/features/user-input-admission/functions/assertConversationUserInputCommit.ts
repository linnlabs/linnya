import type { ConversationUserInputCommittedEvent } from '@app/schemas';

import type { ConversationUserInputCommitExpectation } from '../definitions/conversationUserInputAdmission';

/**
 * Renderer 预分配的是 command identity，只有 Host 的 durable ack 才能把它接纳为 UI message。
 * 这里集中校验身份与操作类型，禁止各编排器自行放宽、猜测或替换 ID。
 */
export function assertConversationUserInputCommit(
  expectation: ConversationUserInputCommitExpectation,
  event: ConversationUserInputCommittedEvent,
): void {
  if (
    event.conversation_id !== expectation.conversationId
    || event.id !== expectation.messageId
    || event.operation !== expectation.operation
  ) {
    throw new Error(
      '[ConversationUserInputAdmission] unexpected durable commit ack: '
      + `conversation=${event.conversation_id}, message=${event.id}, operation=${event.operation}`,
    );
  }

  if (
    expectation.operation === 'replace'
    && event.replaced_from_message_id !== expectation.messageId
  ) {
    throw new Error(
      '[ConversationUserInputAdmission] replacement ack must preserve the original message identity',
    );
  }
}
