import { events as runtimeEvents } from '../../../../runtime-kernel';
import {
  AssistantReplayParts,
  FinalAnswerCompletionReason,
  ProviderContinuations,
  RuntimeEvent,
  ToolOutputMeta,
  type AiMessage,
  type FinalAnswerEvent,
  type ThoughtEvent,
  type UserInputEvent,
} from '../../../../contracts';
import { Logger } from '../../../../shared/logger';

const logger = new Logger('AgentEventConverter');

function isHistorySummaryEvent(event: RuntimeEvent): event is RuntimeEvent & {
  type: 'history_summary';
  content: string;
  original_message_count?: number;
  compression_ratio?: number;
  included_old_summary?: boolean;
  replaced_message_ids?: string[];
  summary_seq?: number;
} {
  return 'type' in event && event.type === 'history_summary';
}

export function convertEventToAiMessage(event: RuntimeEvent): AiMessage {
  if (isHistorySummaryEvent(event)) {
    const replacedIds = Array.isArray(event.replaced_message_ids) ? event.replaced_message_ids : [];

    logger.debug('Converted history_summary RuntimeEvent to AiMessage', {
      summaryId: event.id,
      replacedCount: replacedIds.length,
      summarySeq: event.summary_seq,
      sampleIds: replacedIds.slice(0, 3),
    });

    const projected = runtimeEvents.projectRuntimeEventToAiMessage(event);
    if (projected) return projected;
  }
  const projected = runtimeEvents.projectRuntimeEventToAiMessage(event);
  if (projected) return projected;
  throw new Error(`Unsupported RuntimeEvent type during AiMessage conversion: ${event.type}`);
}

export function convertEventsToAiMessages(events: RuntimeEvent[]): AiMessage[] {
  const filtered = events.filter((event) => {
    if (!runtimeEvents.shouldEnterAgentContext(event)) return false;
    // 带工具调用的流式正文和 tool_call_decision 属于同一个 Assistant turn；
    // 后者持有完整有序 parts，Context 不重复创建一条 assistant 消息。
    return event.type !== 'final_answer' || event.completion_reason !== 'tool_call';
  });
  return filtered.map((event) => convertEventToAiMessage(event));
}

interface AiMessageEventContext {
  conversation_id: string;
  turn_id: string;
  timestamp?: number;
  metadata?: RuntimeEvent['metadata'];
  ephemeral?: boolean;
}

export function convertAiMessageToEvent(
  message: AiMessage,
  context: AiMessageEventContext,
): RuntimeEvent {
  const base: Pick<
    UserInputEvent,
    'id' | 'timestamp' | 'conversation_id' | 'turn_id' | 'version' | 'metadata' | 'ephemeral'
  > = {
    id: message.id,
    timestamp: context.timestamp ?? message.timestamp,
    conversation_id: context.conversation_id,
    turn_id: context.turn_id,
    version: 1,
    ...(context.metadata ? { metadata: context.metadata } : {}),
    ...(context.ephemeral !== undefined ? { ephemeral: context.ephemeral } : {}),
  };

  switch (message.role) {
    case 'user': {
      const event: UserInputEvent = {
        ...base,
        type: 'user_input',
        content: message.content,
        source: 'user',
        ...(message.type === 'user_input' && message.attachments
          ? { attachments: message.attachments }
          : {}),
      };
      return event;
    }

    case 'tool': {
      const toolMetadata = ToolOutputMeta.parse(message.metadata);
      const result = typeof message.metadata?.error === 'string'
        ? {
            status: 'error' as const,
            observation: message.content,
            error: message.metadata.error,
          }
        : {
            status: 'success' as const,
            observation: message.content,
            data: message.metadata?.data,
          };
      return RuntimeEvent.parse({
        ...base,
        type: 'tool_output',
        tool_name: toolMetadata.tool_name,
        tool_call_id: toolMetadata.tool_call_id,
        ...result,
        ...(message.metadata?.presentation !== undefined
          ? { metadata: { ...(base.metadata ?? {}), presentation: message.metadata.presentation } }
          : {}),
        ...(message.attachments ? { attachments: message.attachments } : {}),
      });
    }

    case 'assistant': {
      if (message.type === 'thought') {
        const event: ThoughtEvent = {
          ...base,
          type: 'thought',
          content: message.content,
          is_complete: true,
        };
        return event;
      }
      if (message.type !== 'final_answer') {
        throw new Error(`AiMessage type ${message.type} cannot be converted to a RuntimeEvent.`);
      }

      const providerContinuations = message.metadata?.provider_continuations;
      const assistantReplayParts = message.metadata?.assistant_replay_parts;
      const completionReason = FinalAnswerCompletionReason.parse(message.metadata?.completion_reason);
      const event: FinalAnswerEvent = {
        ...base,
        type: 'final_answer',
        content: message.content,
        answer_id: message.id,
        completion_reason: completionReason,
        is_complete: completionReason !== 'interrupted',
        ...(providerContinuations
          ? { provider_continuations: ProviderContinuations.parse(providerContinuations) }
          : {}),
        ...(assistantReplayParts
          ? { assistant_replay_parts: AssistantReplayParts.parse(assistantReplayParts) }
          : {}),
      };
      return event;
    }

    case 'system': {
      const event: UserInputEvent = {
        ...base,
        type: 'user_input',
        content: message.content,
        source: 'system',
      };
      return event;
    }
  }
}
