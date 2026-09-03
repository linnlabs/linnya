import type { LlmRequestMessage } from '@linnlabs/linnkit/ports';
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

function projectMessages(
  messages: readonly LlmRequestMessage[]
): readonly Record<string, unknown>[] {
  return messages.map(message => {
    if (message.role === 'assistant') {
      const calls = readFunctionToolCalls(message);
      return {
        role: 'assistant',
        content: readMessageText(message),
        ...(calls.length > 0
          ? {
              tool_calls: calls.map(call => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.input) },
              })),
            }
          : {}),
      };
    }
    if (message.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: readToolCallId(message),
        content: readMessageText(message),
      };
    }
    return { role: message.role, content: readMessageText(message) };
  });
}

function buildRequest(input: TokenCountCapabilityInput) {
  const tools = readFunctionToolDefinitions(input.tools);
  return {
    url: appendEndpoint(input.baseURL, 'paas/v4/tokenizer'),
    headers: buildTokenCountHeaders('zai_tokenizer', input.credential),
    body: {
      model: input.endpointModelId,
      messages: projectMessages(input.messages),
      ...(tools.length > 0
        ? {
            tools: tools.map(tool => ({
              type: 'function',
              function: {
                name: tool.name,
                ...(tool.description ? { description: tool.description } : {}),
                parameters: tool.parameters,
              },
            })),
          }
        : {}),
    },
  };
}

function readInputTokens(raw: unknown): number {
  if (!isRecord(raw) || !isRecord(raw.usage)) {
    throw new Error('[TokenAccounting] Z.AI count response 缺少 usage。');
  }
  return requireNonNegativeInteger(raw.usage.total_tokens, 'Z.AI usage.total_tokens');
}

export const ZAI_TOKEN_COUNT_CAPABILITY: TokenCountCapability = {
  surface: 'zai_tokenizer',
  buildRequest,
  readInputTokens,
};
