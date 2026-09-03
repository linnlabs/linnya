import type { AssistantContent, ModelMessage, UserContent } from 'ai';
import type { SharedV4ProviderOptions as ProviderOptions } from '@ai-sdk/provider';
import type {
  CanonicalInferenceCachePolicy,
  CanonicalInferenceMessage,
} from '@linnlabs/linnkit/ports';
import type { ProviderContinuation, SerializableJsonValue } from '@linnlabs/linnkit/contracts';
import { AI_SDK_INFERENCE_CAPABILITY_IDS } from '../definitions/aiSdkCapabilityIds';
import type { AiSdkInferenceRoute } from '../definitions/aiSdkInferenceSurface';

type JsonRecord = Record<string, SerializableJsonValue>;

function cacheBreakpointProviderOptions(
  cachePolicy: CanonicalInferenceCachePolicy | undefined,
  messageIndex: number,
  route: AiSdkInferenceRoute,
): ProviderOptions | undefined {
  if (!cachePolicy?.breakpoints.some(breakpoint => breakpoint.message_index === messageIndex)) {
    return undefined;
  }

  // 显式断点属于具体 Provider capability，不属于相似 wire surface。
  // MiniMax 虽复用 Anthropic codec，但没有声明相同缓存合同；OpenAI 也只有
  // 部分新模型支持显式断点，route 尚未提供该模型能力前统一依赖自动缓存。
  if (route.capability_id === AI_SDK_INFERENCE_CAPABILITY_IDS.ANTHROPIC_MESSAGES) {
    return { anthropic: { cacheControl: { type: 'ephemeral' } } };
  }

  return undefined;
}

function continuationMatchesRoute(
  continuation: ProviderContinuation,
  route: AiSdkInferenceRoute,
): boolean {
  const producer = continuation.producer;
  return (
    producer.model_id === route.model_id &&
    producer.endpoint_id === route.endpoint_id &&
    producer.api_surface === route.surface &&
    producer.capability_id === route.capability_id &&
    producer.endpoint_model_id === route.endpoint_model_id
  );
}

function continuationsForRoute(
  continuations: readonly ProviderContinuation[],
  route: AiSdkInferenceRoute,
): ProviderContinuation[] {
  // continuation 是生成它的 Provider route 的私有 sidecar。切换模型时仍保留
  // canonical 正文、推理和工具历史，但当前 codec 不能解释其他 route 的私有数据。
  return continuations.filter(continuation => continuationMatchesRoute(continuation, route));
}

function requireContinuationPayload(
  continuation: ProviderContinuation,
  route: AiSdkInferenceRoute,
): JsonRecord {
  if (!continuationMatchesRoute(continuation, route)) {
    throw new Error('[AiSdkInference] Provider continuation 与当前 route 不一致。');
  }
  const payload = continuation.payload;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('[AiSdkInference] Provider continuation payload 必须是对象。');
  }
  return payload;
}

function readString(record: JsonRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function readArray(record: JsonRecord, key: string): SerializableJsonValue[] | undefined {
  const value = record[key];
  return Array.isArray(value) ? [...value] : undefined;
}

function readTarget(
  continuation: ProviderContinuation,
  route: AiSdkInferenceRoute,
): { payload: JsonRecord; target: string } {
  const payload = requireContinuationPayload(continuation, route);
  const target = readString(payload, 'target');
  if (!target) throw new Error('[AiSdkInference] Provider continuation 缺少 target。');
  return { payload, target };
}

function providerOptionsFromContinuation(
  continuation: ProviderContinuation,
  route: AiSdkInferenceRoute,
): ProviderOptions {
  const payload = requireContinuationPayload(continuation, route);
  switch (continuation.kind) {
    case 'ai-sdk:anthropic-reasoning': {
      const signature = readString(payload, 'signature');
      const redactedData = readString(payload, 'redacted_data');
      return {
        anthropic: {
          ...(signature ? { signature } : {}),
          ...(redactedData ? { redactedData } : {}),
        },
      };
    }
    case 'ai-sdk:google-part': {
      const thoughtSignature = readString(payload, 'thought_signature');
      if (!thoughtSignature) {
        throw new Error('[AiSdkInference] Google continuation 缺少 thought_signature。');
      }
      return { google: { thoughtSignature } };
    }
    case 'ai-sdk:openai-responses-part': {
      const itemId = readString(payload, 'item_id');
      if (!itemId) throw new Error('[AiSdkInference] OpenAI Responses continuation 缺少 item_id。');
      const reasoningEncryptedContent = readString(payload, 'reasoning_encrypted_content');
      return {
        openai: {
          itemId,
          ...(reasoningEncryptedContent ? { reasoningEncryptedContent } : {}),
        },
      };
    }
    case 'ai-sdk:xai-responses-part': {
      const itemId = readString(payload, 'item_id');
      if (!itemId) throw new Error('[AiSdkInference] xAI Responses continuation 缺少 item_id。');
      const reasoningEncryptedContent = readString(payload, 'reasoning_encrypted_content');
      return {
        xai: {
          itemId,
          ...(reasoningEncryptedContent ? { reasoningEncryptedContent } : {}),
        },
      };
    }
    case 'ai-sdk:openrouter-reasoning': {
      const reasoningDetails = readArray(payload, 'reasoning_details');
      if (!reasoningDetails || reasoningDetails.length === 0) {
        throw new Error('[AiSdkInference] OpenRouter continuation 缺少 reasoning_details。');
      }
      return { openrouter: { reasoning_details: reasoningDetails } };
    }
    default:
      throw new Error(`[AiSdkInference] 不支持的 Provider continuation kind: ${continuation.kind}`);
  }
}

function mergeProviderOptions(options: readonly ProviderOptions[]): ProviderOptions | undefined {
  if (options.length === 0) return undefined;
  const merged: ProviderOptions = {};
  for (const option of options) {
    for (const [provider, value] of Object.entries(option)) {
      merged[provider] = { ...(merged[provider] ?? {}), ...value };
    }
  }
  return merged;
}

function projectUserContent(
  message: Extract<CanonicalInferenceMessage, { role: 'user' }>,
): UserContent {
  return message.content.map(block =>
    block.type === 'text'
      ? { type: 'text', text: block.text }
      : {
          type: 'file',
          data: { type: 'data', data: block.bytes },
          mediaType: block.media_type,
        },
  );
}

function indexToolCalls(messages: readonly CanonicalInferenceMessage[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const part of message.parts) {
      if (part.type !== 'tool_call') continue;
      const call = part.call;
      if (names.has(call.id)) {
        throw new Error(`[AiSdkInference] 对话包含重复 tool_call_id: ${call.id}`);
      }
      names.set(call.id, call.name);
    }
  }
  return names;
}

function projectAssistantContent(
  message: Extract<CanonicalInferenceMessage, { role: 'assistant' }>,
  route: AiSdkInferenceRoute,
): AssistantContent {
  return message.parts.map(part => {
    if (part.type === 'tool_call') {
      const continuations = continuationsForRoute(part.call.continuation ?? [], route);
      for (const value of continuations) {
        const { payload, target } = readTarget(value, route);
        if (target !== 'tool_call') {
          throw new Error('[AiSdkInference] Provider continuation target 与 assistant tool part 不一致。');
        }
        if (readString(payload, 'tool_call_id') !== part.call.id) {
          throw new Error('[AiSdkInference] Provider continuation tool_call_id 与 assistant tool part 不一致。');
        }
      }
      const providerOptions = mergeProviderOptions(
        continuations.map(value => providerOptionsFromContinuation(value, route)),
      );
      return {
        type: 'tool-call',
        toolCallId: part.call.id,
        toolName: part.call.name,
        input: part.call.arguments,
        ...(providerOptions ? { providerOptions } : {}),
      };
    }
    const continuations = continuationsForRoute(part.continuation ?? [], route);
    for (const value of continuations) {
      const { target } = readTarget(value, route);
      if (target !== part.type) {
        throw new Error('[AiSdkInference] Provider continuation target 与 assistant part 不一致。');
      }
    }
    const providerOptions = mergeProviderOptions(
      continuations.map(value => providerOptionsFromContinuation(value, route)),
    );
    return {
      type: part.type,
      text: part.text,
      ...(providerOptions ? { providerOptions } : {}),
    };
  });
}

function projectToolContent(
  message: Extract<CanonicalInferenceMessage, { role: 'tool' }>,
  toolNames: ReadonlyMap<string, string>,
) {
  const toolName = toolNames.get(message.tool_call_id);
  if (!toolName) {
    throw new Error(
      `[AiSdkInference] tool result 找不到已完成的 assistant tool call: ${message.tool_call_id}`,
    );
  }
  const files = message.content.filter(block => block.type === 'image');
  const text = message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');
  return [{
    type: 'tool-result' as const,
    toolCallId: message.tool_call_id,
    toolName,
    output: files.length === 0
      ? { type: 'text' as const, value: text }
      : {
          type: 'content' as const,
          value: [
            ...(text ? [{ type: 'text' as const, text }] : []),
            ...files.map(file => ({
              type: 'file' as const,
              data: { type: 'data' as const, data: file.bytes },
              mediaType: file.media_type,
            })),
          ],
        },
  }];
}

export function projectCanonicalMessages(
  messages: readonly CanonicalInferenceMessage[],
  route: AiSdkInferenceRoute,
  cachePolicy?: CanonicalInferenceCachePolicy,
): ModelMessage[] {
  const toolNames = indexToolCalls(messages);
  return messages.map((message, messageIndex) => {
    const providerOptions = cacheBreakpointProviderOptions(cachePolicy, messageIndex, route);
    switch (message.role) {
      case 'system':
        return {
          role: 'system',
          content: message.content,
          ...(providerOptions ? { providerOptions } : {}),
        };
      case 'user':
        return {
          role: 'user',
          content: projectUserContent(message),
          ...(providerOptions ? { providerOptions } : {}),
        };
      case 'assistant':
        return {
          role: 'assistant',
          content: projectAssistantContent(message, route),
          ...(providerOptions ? { providerOptions } : {}),
        };
      case 'tool':
        return {
          role: 'tool',
          content: projectToolContent(message, toolNames),
          ...(providerOptions ? { providerOptions } : {}),
        };
    }
  });
}
