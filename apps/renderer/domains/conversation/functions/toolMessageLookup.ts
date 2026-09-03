import type { BaseMessage } from '../types';
import { parseConversationToolMessageMetadata } from '@app/schemas';

export interface ToolMessageLookupResult {
  message: BaseMessage;
  toolCallId: string;
  toolName: string;
}

export function readToolCallIdFromMessage(message: BaseMessage): string | null {
  if (message.type !== 'tool_calls') return null;
  return parseConversationToolMessageMetadata(message.metadata).tool_call_id;
}

export function readToolNameFromConversationMessage(message: BaseMessage): string | null {
  if (message.type !== 'tool_calls') return null;
  return parseConversationToolMessageMetadata(message.metadata).tool_name;
}

export function findToolMessageByToolCallId(
  messages: readonly BaseMessage[],
  toolCallId: string,
): ToolMessageLookupResult | null {
  const normalizedToolCallId = toolCallId.trim();
  if (!normalizedToolCallId) return null;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.type !== 'tool_calls') continue;

    const metadata = parseConversationToolMessageMetadata(message.metadata);
    if (metadata.tool_call_id === normalizedToolCallId) {
      return {
        message,
        toolCallId: metadata.tool_call_id,
        toolName: metadata.tool_name,
      };
    }
  }

  return null;
}
