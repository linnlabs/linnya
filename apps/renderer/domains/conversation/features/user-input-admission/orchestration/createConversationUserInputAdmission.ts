import type { ConversationUserInputCommittedEvent } from '@app/schemas';

import type { BaseMessage } from '../../../types';
import type {
  ConversationUserInputAdmission,
  CreateConversationUserInputAdmissionOptions,
} from '../definitions/conversationUserInputAdmission';
import { assertConversationUserInputCommit } from '../functions/assertConversationUserInputCommit';

/**
 * 创建一次请求独享的用户输入接纳器。
 *
 * 用户输入消息的正式创建点在 Host durable transaction，不在 Renderer。Renderer 只能持有
 * command identity，并在收到 `user_input_committed` 后把同一事实提交到 projection store。
 */
export function createConversationUserInputAdmission(
  options: CreateConversationUserInputAdmissionOptions,
): ConversationUserInputAdmission {
  let committedMessage: BaseMessage | null = null;

  return {
    accept(event: ConversationUserInputCommittedEvent): BaseMessage {
      if (committedMessage) {
        throw new Error('[ConversationUserInputAdmission] durable commit ack received more than once');
      }
      assertConversationUserInputCommit(options.expectation, event);
      const message = options.commitUserInput(event);
      committedMessage = message;
      options.onCommitted?.(message, event);
      return message;
    },
    get committedMessage(): BaseMessage | null {
      return committedMessage;
    },
  };
}
