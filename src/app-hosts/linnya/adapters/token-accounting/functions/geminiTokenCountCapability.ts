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

type GeminiPart =
  | { readonly text: string }
  | { readonly functionCall: { readonly name: string; readonly args: Record<string, unknown> } }
  | {
      readonly functionResponse: {
        readonly name: string;
        readonly response: { readonly result: string };
      };
    };

interface GeminiContent {
  readonly role: 'user' | 'model';
  readonly parts: readonly GeminiPart[];
}

function projectGeminiContents(messages: readonly LlmRequestMessage[]): {
  readonly systemInstruction?: { readonly parts: readonly [{ readonly text: string }] };
  readonly contents: readonly GeminiContent[];
} {
  const system: string[] = [];
  const contents: GeminiContent[] = [];
  const toolNames = new Map<string, string>();
  for (const message of messages) {
    if (message.role === 'system') {
      system.push(readMessageText(message));
      continue;
    }
    if (message.role === 'assistant') {
      const calls = readFunctionToolCalls(message);
      for (const call of calls) toolNames.set(call.id, call.name);
      const messageText = readMessageText(message);
      contents.push({
        role: 'model',
        parts: [
          ...(messageText ? [{ text: messageText }] : []),
          ...calls.map(call => ({ functionCall: { name: call.name, args: call.input } })),
        ],
      });
      continue;
    }
    if (message.role === 'tool') {
      const toolCallId = readToolCallId(message);
      const name = toolNames.get(toolCallId);
      if (!name)
        throw new Error(`[TokenAccounting] Gemini tool result 找不到 tool call: ${toolCallId}`);
      contents.push({
        role: 'user',
        parts: [{ functionResponse: { name, response: { result: readMessageText(message) } } }],
      });
      continue;
    }
    contents.push({ role: 'user', parts: [{ text: readMessageText(message) }] });
  }
  const systemText = system
    .map(value => value.trim())
    .filter(Boolean)
    .join('\n\n');
  return {
    ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
    contents,
  };
}

function buildRequest(input: TokenCountCapabilityInput) {
  const tools = readFunctionToolDefinitions(input.tools);
  const modelName = `models/${input.endpointModelId}`;
  return {
    url: appendEndpoint(input.baseURL, `${modelName}:countTokens`),
    headers: buildTokenCountHeaders('gemini_generate_content_count_tokens', input.credential),
    body: {
      generateContentRequest: {
        model: modelName,
        ...projectGeminiContents(input.messages),
        ...(tools.length > 0
          ? {
              tools: [
                {
                  functionDeclarations: tools.map(tool => ({
                    name: tool.name,
                    ...(tool.description ? { description: tool.description } : {}),
                    parameters: tool.parameters,
                  })),
                },
              ],
            }
          : {}),
      },
    },
  };
}

function readInputTokens(raw: unknown): number {
  if (!isRecord(raw)) throw new Error('[TokenAccounting] Gemini count response 必须是对象。');
  return requireNonNegativeInteger(raw.totalTokens, 'Gemini totalTokens');
}

export const GEMINI_TOKEN_COUNT_CAPABILITY: TokenCountCapability = {
  surface: 'gemini_generate_content_count_tokens',
  buildRequest,
  readInputTokens,
};
