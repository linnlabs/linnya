import type { FinalAnswerCompletionReason } from '@linnlabs/linnkit/contracts';
import type { MessageType } from '../../../types';

/** 把 durable segment 语义映射为 UI 消息类型，禁止把可见播报伪装成 thought。 */
export function resolveAnswerSegmentMessageType(
  reason: FinalAnswerCompletionReason,
): Extract<MessageType, 'final_answer' | 'tool_preamble' | 'partial_answer'> {
  switch (reason) {
    case 'terminal':
      return 'final_answer';
    case 'tool_call':
      return 'tool_preamble';
    case 'interrupted':
      return 'partial_answer';
  }
}
