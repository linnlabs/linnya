import type { ConversationMessageId } from '@app/schemas';

import type { BaseMessage, ToolCallMessage } from '../../../types';

/**
 * 详情只按正式父消息身份恢复 live trace，禁止在 active messages 中猜最近的 subagent。
 */
export function resolveSubrunDetailParentMessage(params: {
  readonly messages: readonly BaseMessage[];
  readonly parentMessageId: ConversationMessageId;
  readonly parentToolCallId: string;
}): ToolCallMessage | null {
  const message = params.messages.find(candidate => candidate.id === params.parentMessageId);
  if (!message || message.type !== 'tool_calls') return null;
  return message.metadata.tool_call_id === params.parentToolCallId ? message : null;
}
