import type { ConversationUserInputCommittedEvent } from '@app/schemas';

import type { BaseMessage } from '../../../types';

export interface ConversationUserInputCommitExpectation {
  readonly conversationId: string;
  readonly messageId: string;
  readonly operation: 'append' | 'replace';
}

export interface ConversationUserInputAdmission {
  /**
   * 接纳 Host 已完成 durable commit 的用户输入事实。
   * 同一个 admission 只允许成功一次；重复确认表示 transport 合同已被破坏。
   */
  accept(event: ConversationUserInputCommittedEvent): BaseMessage;
  readonly committedMessage: BaseMessage | null;
}

export interface CreateConversationUserInputAdmissionOptions {
  readonly expectation: ConversationUserInputCommitExpectation;
  readonly commitUserInput: (event: ConversationUserInputCommittedEvent) => BaseMessage;
  readonly onCommitted?: (
    message: BaseMessage,
    event: ConversationUserInputCommittedEvent,
  ) => void;
}
