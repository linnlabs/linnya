import {
  conversationSummarizationPresentationIdFromEventId,
  ConversationHistorySummaryPayloadSchema,
  ConversationSummarizationProgressMetadataSchema,
  ConversationThoughtMessageMetadataSchema,
  ConversationToolMessageMetadataSchema,
  ConversationUserMessageMetadataSchema,
  parseConversationAnswerMessageMetadata,
  type ConversationAnswerMessageMetadata,
  type ConversationThoughtMessageMetadata,
  type ConversationToolMessageMetadata,
  type ConversationUserMessageMetadata,
} from '@app/schemas';
import type {
  AnswerMessage,
  HistorySummaryMessage,
  SummarizationProgressMessage,
  ThoughtMessage,
  ToolCallMessage,
  UserMessage,
} from '../../types';
import type { BaseMessage } from '../../types';

type CommonOverrides<Message extends { id: string; content: string; timestamp: number }> = Partial<
  Pick<Message, 'id' | 'content' | 'timestamp'>
>;

export function createTestUserMessage(
  overrides: CommonOverrides<UserMessage> & {
    readonly metadata?: Partial<ConversationUserMessageMetadata>;
  } = {}
): UserMessage {
  const id = overrides.id ?? 'test-user-message';
  return {
    id,
    role: 'user',
    type: 'user_input',
    content: overrides.content ?? 'Test user input',
    timestamp: overrides.timestamp ?? 1,
    metadata: ConversationUserMessageMetadataSchema.parse({
      turn_id: `turn-${id}`,
      run_id: `run-${id}`,
      ...overrides.metadata,
    }),
  };
}

export function createTestThoughtMessage(
  overrides: CommonOverrides<ThoughtMessage> & {
    readonly metadata?: Partial<ConversationThoughtMessageMetadata>;
  } = {}
): ThoughtMessage {
  const id = overrides.id ?? 'test-thought-message';
  const timestamp = overrides.timestamp ?? 2;
  return {
    id,
    role: 'assistant',
    type: 'thought',
    content: overrides.content ?? 'Test thought',
    timestamp,
    metadata: ConversationThoughtMessageMetadataSchema.parse({
      turn_id: `turn-${id}`,
      run_id: `run-${id}`,
      is_complete: true,
      thought_started_at: timestamp,
      thought_completed_at: timestamp,
      ...overrides.metadata,
    }),
  };
}

export function createTestToolMessage(
  overrides: CommonOverrides<ToolCallMessage> & {
    readonly metadata?: Partial<ConversationToolMessageMetadata>;
  } = {}
): ToolCallMessage {
  const id = overrides.id ?? 'test-tool-message';
  const timestamp = overrides.timestamp ?? 3;
  const metadata = overrides.metadata ?? {};
  const status = metadata.status ?? 'success';
  return {
    id,
    role: 'assistant',
    type: 'tool_calls',
    content: overrides.content ?? '',
    timestamp,
    metadata: ConversationToolMessageMetadataSchema.parse({
      tool_call_id: `call-${id}`,
      tool_name: 'test_tool',
      status,
      phase: status === 'loading' ? 'start' : status === 'error' ? 'error' : 'complete',
      turn_id: `turn-${id}`,
      run_id: `run-${id}`,
      started_at: timestamp,
      ...(status === 'loading' ? {} : { completed_at: timestamp }),
      ...(status === 'success' ? { data: {} } : {}),
      ...metadata,
    }),
  };
}

export function createTestAnswerMessage(
  overrides: CommonOverrides<AnswerMessage> & {
    readonly type?: AnswerMessage['type'];
    readonly metadata?: Partial<ConversationAnswerMessageMetadata>;
  } = {}
): AnswerMessage {
  const id = overrides.id ?? 'test-answer-message';
  const timestamp = overrides.timestamp ?? 4;
  const type = overrides.type ?? 'final_answer';
  const isComplete = overrides.metadata?.is_complete ?? type !== 'partial_answer';
  const completionReason =
    type === 'final_answer'
      ? isComplete
        ? 'terminal'
        : undefined
      : type === 'tool_preamble'
        ? 'tool_call'
        : 'interrupted';
  const metadataInput = {
    answer_id: id,
    turn_id: `turn-${id}`,
    run_id: `run-${id}`,
    is_complete: isComplete,
    ...(completionReason ? { completion_reason: completionReason } : {}),
    first_token_at: timestamp,
    ...overrides.metadata,
  };
  const common = {
    id,
    role: 'assistant',
    content: overrides.content ?? 'Test answer',
    timestamp,
  } as const;
  switch (type) {
    case 'final_answer':
      return {
        ...common,
        type,
        metadata: parseConversationAnswerMessageMetadata(type, metadataInput),
      };
    case 'tool_preamble':
      return {
        ...common,
        type,
        metadata: parseConversationAnswerMessageMetadata(type, metadataInput),
      };
    case 'partial_answer':
      return {
        ...common,
        type,
        metadata: parseConversationAnswerMessageMetadata(type, metadataInput),
      };
  }
}

export function createTestHistorySummaryMessage(
  overrides: CommonOverrides<HistorySummaryMessage> = {}
): HistorySummaryMessage {
  const id = overrides.id ?? 'test-history-summary';
  return {
    id,
    role: 'system',
    type: 'history_summary',
    content: overrides.content ?? 'Test history summary',
    timestamp: overrides.timestamp ?? 5,
    metadata: {
      ...ConversationHistorySummaryPayloadSchema.parse({
        summary: {
          info: { originalMessageCount: 1, compressedMessageCount: 1 },
          replacedMessageIds: ['test-user-message'],
        },
      }),
      turn_id: `turn-${id}`,
      run_id: `run-${id}`,
    },
  };
}

export function createTestSummarizationProgressMessage(
  overrides: CommonOverrides<SummarizationProgressMessage> = {}
): SummarizationProgressMessage {
  const id = ConversationSummarizationProgressMetadataSchema.parse({
    summarization_id: 'test-summarization',
    run_id: 'run-test-summarization',
    execution_id: 'execution-test-summarization',
    turn_id: 'turn-test-summarization',
    summary: {
      status: 'summarizing',
      info: { originalMessageCount: 1 },
    },
  });
  return {
    id:
      overrides.id ??
      conversationSummarizationPresentationIdFromEventId('test-summarization-start'),
    role: 'system',
    type: 'summarization_progress',
    content: overrides.content ?? '',
    timestamp: overrides.timestamp ?? 6,
    metadata: id,
  };
}

/** 测试断言同时负责 TypeScript 收窄；禁止用属性索引绕过消息判别联合。 */
export function requireTestToolMessage(message: BaseMessage | null | undefined): ToolCallMessage {
  if (message?.type !== 'tool_calls') {
    throw new Error(`Expected tool_calls message, received ${message?.type ?? 'missing'}`);
  }
  return message;
}

export function requireTestAnswerMessage(message: BaseMessage | null | undefined): AnswerMessage {
  if (
    message?.type !== 'final_answer' &&
    message?.type !== 'tool_preamble' &&
    message?.type !== 'partial_answer'
  ) {
    throw new Error(`Expected answer message, received ${message?.type ?? 'missing'}`);
  }
  return message;
}

export function requireTestHistorySummaryMessage(
  message: BaseMessage | null | undefined
): HistorySummaryMessage {
  if (message?.type !== 'history_summary') {
    throw new Error(`Expected history_summary message, received ${message?.type ?? 'missing'}`);
  }
  return message;
}
