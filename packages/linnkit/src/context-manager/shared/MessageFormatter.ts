import type {
  AiMessage,
  AssistantReplayPart,
  ProviderContinuation,
  RuntimeResourceRef,
} from '../../contracts';
import type { FenceRegistry } from './fences';
import type { ChatMessage } from './contracts/chatLineMessage';
import { Logger } from '../../shared/logger';

const logger = new Logger('MessageFormatter');

export interface MessageFormatOptions {
  nativeTools?: boolean;
  fenceRegistry?: FenceRegistry;
}

export interface MessageFormatterOptions {
  fenceRegistry?: FenceRegistry;
}

export type NativeToolCallingMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string; attachments?: RuntimeResourceRef[] }
  | {
      role: 'assistant';
      content: string;
      provider_continuations?: ProviderContinuation[];
      assistant_replay_parts?: AssistantReplayPart[];
    }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls: unknown[];
      provider_continuations?: ProviderContinuation[];
      assistant_replay_parts?: AssistantReplayPart[];
    }
  | { role: 'tool'; tool_call_id: string; content: string; attachments?: RuntimeResourceRef[] };

class MessageFormatter {
  private readonly fenceRegistry?: FenceRegistry;

  constructor(options: MessageFormatterOptions = {}) {
    this.fenceRegistry = options.fenceRegistry;
  }

  public format(
    messages: AiMessage[],
    options: { nativeTools: true },
  ): NativeToolCallingMessage[];
  public format(
    messages: AiMessage[],
    options?: { nativeTools?: false },
  ): ChatMessage[];
  public format(messages: AiMessage[], options: MessageFormatOptions = {}): (ChatMessage | NativeToolCallingMessage)[] {
    return messages
      .map((msg) => this.formatSingleMessage(msg, options))
      .filter((msg): msg is ChatMessage | NativeToolCallingMessage => msg !== null);
  }

  private formatSingleMessage(
    message: AiMessage,
    options: MessageFormatOptions,
  ): ChatMessage | NativeToolCallingMessage | null {
    const { role, type, content, metadata } = message;
    const fenceRegistry = options.fenceRegistry ?? this.fenceRegistry;

    if (options.nativeTools) {
      if (role === 'assistant' && type === 'tool_calls' && metadata?.tool_calls) {
        const toolCallsRaw = metadata.tool_calls;
        const toolCalls = Array.isArray(toolCallsRaw) ? toolCallsRaw : [];
        const providerContinuations = metadata.provider_continuations;
        const assistantReplayParts = metadata.assistant_replay_parts;
        return {
          role: 'assistant',
          content: content || null,
          tool_calls: toolCalls,
          ...(providerContinuations?.length ? { provider_continuations: providerContinuations } : {}),
          ...(assistantReplayParts?.length ? { assistant_replay_parts: assistantReplayParts } : {}),
        };
      }

      if (role === 'assistant' && type === 'final_answer') {
        const providerContinuations = metadata?.provider_continuations;
        const assistantReplayParts = metadata?.assistant_replay_parts;
        return {
          role: 'assistant',
          content,
          ...(providerContinuations?.length ? { provider_continuations: providerContinuations } : {}),
          ...(assistantReplayParts?.length ? { assistant_replay_parts: assistantReplayParts } : {}),
        };
      }

      if (role === 'tool' && type === 'tool_output' && metadata?.tool_call_id) {
        return {
          role: 'tool',
          tool_call_id: metadata.tool_call_id,
          content,
          ...(message.attachments ? { attachments: message.attachments } : {}),
        };
      }
    }

    if (type === 'tool_output') {
      return null;
    }
    if (role !== 'user' && role !== 'assistant' && role !== 'system') {
      return null;
    }

    switch (type) {
      case 'system_prompt':
      case 'final_answer':
        return { role, content };
      case 'user_input':
        return {
          role: 'user',
          content,
          ...(message.attachments ? { attachments: message.attachments } : {}),
        };
      case 'context_injection': {
        const fenceKind = metadata?.fenceKind;
        if (!fenceKind) {
          logger.warn('context_injection missing metadata.fenceKind, skipping');
          return null;
        }
        const descriptor = fenceRegistry?.get(fenceKind);
        if (!descriptor) {
          logger.warn('fence kind is not registered, skipping', { fenceKind });
          return null;
        }
        return {
          role: descriptor.llmRole,
          content: descriptor.formatter(content, metadata?.fenceAttrs ?? {}),
        };
      }
      case 'history_summary':
        return { role: 'system', content };
      case 'thought':
        return null;
      case 'tool_calls': {
        const toolCalls = metadata?.tool_calls;
        if (Array.isArray(toolCalls) && toolCalls.length > 0) {
          const firstToolCall = toolCalls[0];
          const toolName = firstToolCall.function?.name;
          const toolArgs = firstToolCall.function?.arguments;
          if (toolName && toolArgs) {
            const call = {
              name: toolName,
              arguments: typeof toolArgs === 'string' ? JSON.parse(toolArgs) : toolArgs,
            };
            return { role, content: `<tool_code>${JSON.stringify(call)}</tool_code>` };
          }
        }
        return null;
      }
      case 'tool_code': {
        const { tool_name, args } = metadata || {};
        if (tool_name && args) {
          return { role, content: `<tool_code>${JSON.stringify({ name: tool_name, arguments: args })}</tool_code>` };
        }
        return null;
      }
      case 'task_request':
      case 'task_completion':
        return { role, content };
      default:
        logger.warn('unhandled message type for chat history, skipping', { type });
        return null;
    }
  }

}

export const messageFormatter = new MessageFormatter();
export function createMessageFormatter(options: MessageFormatterOptions = {}): MessageFormatter {
  return new MessageFormatter(options);
}
export function formatAgentLlmMessages(
  messages: AiMessage[],
  options: Pick<MessageFormatOptions, 'fenceRegistry'> = {},
): NativeToolCallingMessage[] {
  return messageFormatter.format(messages, { nativeTools: true, ...options });
}
export type LlmMessage = ChatMessage | NativeToolCallingMessage;
