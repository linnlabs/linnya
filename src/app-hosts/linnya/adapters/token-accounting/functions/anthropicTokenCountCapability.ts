import type { LlmRequestMessage } from 'linnkit/ports';
import type {
  TokenCountCapability,
  TokenCountCapabilityInput,
} from '../definitions/tokenCountCapability';
import { buildTokenCountHeaders } from './buildTokenCountHeaders';
import {
  appendEndpoint,
  isRecord,
  readFunctionToolCalls,
  readFunctionToolDefinitions,
  readMessageText,
  readToolCallId,
  requireNonNegativeInteger,
} from './tokenCountCodecPrimitives';

type AnthropicContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'tool_use';
      readonly id: string;
      readonly name: string;
      readonly input: Record<string, unknown>;
    }
  | { readonly type: 'tool_result'; readonly tool_use_id: string; readonly content: string };

interface AnthropicMessage {
  readonly role: 'user' | 'assistant';
  readonly content: AnthropicContentBlock[];
}

function appendMessage(
  messages: AnthropicMessage[],
  role: AnthropicMessage['role'],
  blocks: readonly AnthropicContentBlock[]
): void {
  const previous = messages[messages.length - 1];
  if (previous?.role === role) {
    previous.content.push(...blocks);
    return;
  }
  messages.push({ role, content: [...blocks] });
}

function projectAnthropicMessages(messages: readonly LlmRequestMessage[]): {
  readonly system?: string;
  readonly messages: readonly AnthropicMessage[];
} {
  const system: string[] = [];
  const projected: AnthropicMessage[] = [];
  for (const message of messages) {
    if (message.role === 'system') {
      system.push(readMessageText(message));
      continue;
    }
    if (message.role === 'user') {
      appendMessage(projected, 'user', [{ type: 'text', text: readMessageText(message) }]);
      continue;
    }
    if (message.role === 'assistant') {
      const calls = readFunctionToolCalls(message);
      const messageText = readMessageText(message);
      appendMessage(projected, 'assistant', [
        ...(messageText ? [{ type: 'text' as const, text: messageText }] : []),
        ...calls.map(call => ({
          type: 'tool_use' as const,
          id: call.id,
          name: call.name,
          input: call.input,
        })),
      ]);
      continue;
    }
    appendMessage(projected, 'user', [
      {
        type: 'tool_result',
        tool_use_id: readToolCallId(message),
        content: readMessageText(message),
      },
    ]);
  }
  const systemText = system
    .map(value => value.trim())
    .filter(Boolean)
    .join('\n\n');
  return {
    ...(systemText ? { system: systemText } : {}),
    messages: projected,
  };
}

function buildRequest(input: TokenCountCapabilityInput) {
  const projected = projectAnthropicMessages(input.messages);
  const tools = readFunctionToolDefinitions(input.tools);
  return {
    url: appendEndpoint(input.baseURL, 'messages/count_tokens'),
    headers: buildTokenCountHeaders('anthropic_messages_count_tokens', input.credential),
    body: {
      model: input.endpointModelId,
      ...projected,
      ...(tools.length > 0
        ? {
            tools: tools.map(tool => ({
              name: tool.name,
              ...(tool.description ? { description: tool.description } : {}),
              input_schema: tool.parameters,
            })),
          }
        : {}),
    },
  };
}

function readInputTokens(raw: unknown): number {
  if (!isRecord(raw)) throw new Error('[TokenAccounting] Anthropic count response 必须是对象。');
  return requireNonNegativeInteger(raw.input_tokens, 'Anthropic input_tokens');
}

export const ANTHROPIC_TOKEN_COUNT_CAPABILITY: TokenCountCapability = {
  surface: 'anthropic_messages_count_tokens',
  buildRequest,
  readInputTokens,
};
