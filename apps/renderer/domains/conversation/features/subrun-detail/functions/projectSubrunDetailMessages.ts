import {
  conversationSubrunMessageIdFromInvocation,
  ConversationUserMessageMetadataSchema,
  SubagentArgsSchema,
} from '@app/schemas';

import type {
  BaseMessage,
  ToolCallMessage,
  UserMessage,
} from '../../../types';

/**
 * 父 Agent 交给 child 的 prompt 是 subagent 调用的正式输入事实。
 * 详情只把它投影成 read-model user message，不写入父 Conversation window，也不赋予重跑语义。
 */
export function projectSubrunInvocationMessage(params: {
  readonly parentMessage: ToolCallMessage;
  readonly subrunId: string;
}): UserMessage {
  const args = SubagentArgsSchema.parse(params.parentMessage.metadata.args);
  return {
    id: conversationSubrunMessageIdFromInvocation(params.subrunId),
    role: 'user',
    type: 'user_input',
    content: args.prompt,
    timestamp: params.parentMessage.timestamp,
    metadata: ConversationUserMessageMetadataSchema.parse({
      activity: {
        runId: params.subrunId,
        feature: 'subagent_general',
      },
    }),
  };
}

export function projectSubrunDetailMessages(params: {
  readonly parentMessage: ToolCallMessage;
  readonly subrunId: string;
  readonly childMessages: readonly BaseMessage[];
}): readonly BaseMessage[] {
  return [
    projectSubrunInvocationMessage(params),
    ...params.childMessages,
  ];
}
