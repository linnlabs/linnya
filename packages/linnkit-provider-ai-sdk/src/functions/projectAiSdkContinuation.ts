import type { ProviderMetadata } from 'ai';
import type { ProviderContinuation, SerializableJsonValue } from '@linnlabs/linnkit/contracts';
import { AI_SDK_INFERENCE_CAPABILITY_IDS } from '../definitions/aiSdkCapabilityIds';
import type { AiSdkInferenceRoute } from '../definitions/aiSdkInferenceSurface';
import type { AiSdkInferenceSurface } from '../definitions/aiSdkInferenceSurface';

type JsonRecord = Record<string, SerializableJsonValue>;

export type AiSdkContinuationTarget =
  | { readonly type: 'reasoning'; readonly text: string }
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'tool_call'; readonly tool_call_id: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readProviderRecord(
  metadata: ProviderMetadata | undefined,
  provider: 'openai' | 'anthropic' | 'google' | 'xai' | 'openrouter'
): Record<string, unknown> | undefined {
  const value = metadata?.[provider];
  return isRecord(value) ? value : undefined;
}

function optionalStringOrNull(
  record: Record<string, unknown>,
  key: string
): string | null | undefined {
  const value = record[key];
  return typeof value === 'string' || value === null ? value : undefined;
}

function projectOpenRouterReasoningDetail(value: unknown): JsonRecord | undefined {
  if (!isRecord(value)) return undefined;
  const type = value.type;
  if (type !== 'reasoning.summary' && type !== 'reasoning.encrypted' && type !== 'reasoning.text') {
    return undefined;
  }

  const id = optionalStringOrNull(value, 'id');
  const format = optionalStringOrNull(value, 'format');
  const index = value.index;
  const common: JsonRecord = {
    type,
    ...(id !== undefined ? { id } : {}),
    ...(format !== undefined ? { format } : {}),
    ...(typeof index === 'number' && Number.isFinite(index) ? { index } : {}),
  };

  if (type === 'reasoning.summary') {
    const summary = readString(value, 'summary');
    return summary ? { ...common, summary } : undefined;
  }
  if (type === 'reasoning.encrypted') {
    const data = readString(value, 'data');
    return data ? { ...common, data } : undefined;
  }
  const text = optionalStringOrNull(value, 'text');
  const signature = optionalStringOrNull(value, 'signature');
  return {
    ...common,
    ...(text !== undefined ? { text } : {}),
    ...(signature !== undefined ? { signature } : {}),
  };
}

function projectOpenRouter(
  route: AiSdkInferenceRoute,
  metadata: ProviderMetadata | undefined,
  target: AiSdkContinuationTarget
): ProviderContinuation | undefined {
  const provider = readProviderRecord(metadata, 'openrouter');
  const rawDetails = provider?.reasoning_details;
  if (!Array.isArray(rawDetails)) return undefined;
  const reasoningDetails = rawDetails
    .map(projectOpenRouterReasoningDetail)
    .filter((detail): detail is JsonRecord => detail !== undefined);
  if (reasoningDetails.length === 0) return undefined;
  return continuation(route, 'ai-sdk:openrouter-reasoning', {
    ...targetPayload(target),
    reasoning_details: reasoningDetails,
  });
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function targetPayload(target: AiSdkContinuationTarget): JsonRecord {
  switch (target.type) {
    case 'reasoning':
      return { target: 'reasoning', text: target.text };
    case 'text':
      return { target: 'text', text: target.text };
    case 'tool_call':
      return { target: 'tool_call', tool_call_id: target.tool_call_id };
  }
}

function continuation(
  route: AiSdkInferenceRoute,
  kind: string,
  payload: JsonRecord
): ProviderContinuation {
  return {
    schema_version: 2,
    producer: {
      model_id: route.model_id,
      endpoint_id: route.endpoint_id,
      api_surface: route.surface,
      capability_id: route.capability_id,
      endpoint_model_id: route.endpoint_model_id,
    },
    kind,
    payload,
  };
}

function projectAnthropic(
  route: AiSdkInferenceRoute,
  metadata: ProviderMetadata | undefined,
  target: AiSdkContinuationTarget
): ProviderContinuation | undefined {
  if (target.type !== 'reasoning') return undefined;
  const provider = readProviderRecord(metadata, 'anthropic');
  if (!provider) return undefined;
  const signature = readString(provider, 'signature');
  const redactedData = readString(provider, 'redactedData');
  if (!signature && !redactedData) return undefined;
  return continuation(route, 'ai-sdk:anthropic-reasoning', {
    ...targetPayload(target),
    ...(signature ? { signature } : {}),
    ...(redactedData ? { redacted_data: redactedData } : {}),
  });
}

function projectGoogle(
  route: AiSdkInferenceRoute,
  metadata: ProviderMetadata | undefined,
  target: AiSdkContinuationTarget
): ProviderContinuation | undefined {
  const provider = readProviderRecord(metadata, 'google');
  if (!provider) return undefined;
  const thoughtSignature = readString(provider, 'thoughtSignature');
  if (!thoughtSignature) return undefined;
  return continuation(route, 'ai-sdk:google-part', {
    ...targetPayload(target),
    thought_signature: thoughtSignature,
  });
}

function projectResponses(
  route: AiSdkInferenceRoute,
  metadata: ProviderMetadata | undefined,
  target: AiSdkContinuationTarget,
  providerId: 'openai' | 'xai',
  kind: 'ai-sdk:openai-responses-part' | 'ai-sdk:xai-responses-part'
): ProviderContinuation | undefined {
  const provider = readProviderRecord(metadata, providerId);
  if (!provider) return undefined;
  const itemId = readString(provider, 'itemId');
  if (!itemId) return undefined;
  const encryptedContent = readString(provider, 'reasoningEncryptedContent');
  return continuation(route, kind, {
    ...targetPayload(target),
    item_id: itemId,
    ...(encryptedContent ? { reasoning_encrypted_content: encryptedContent } : {}),
  });
}

/** 只提取下一轮 replay 必需的 allowlist 字段，不持久化整份 providerMetadata。 */
export function projectAiSdkContinuation(
  surface: AiSdkInferenceSurface,
  route: AiSdkInferenceRoute,
  metadata: ProviderMetadata | undefined,
  target: AiSdkContinuationTarget
): ProviderContinuation | undefined {
  switch (surface) {
    case 'openai_chat_completions':
      return route.capability_id === AI_SDK_INFERENCE_CAPABILITY_IDS.OPENROUTER_CHAT
        ? projectOpenRouter(route, metadata, target)
        : undefined;
    case 'openai_responses':
      switch (route.capability_id) {
        case AI_SDK_INFERENCE_CAPABILITY_IDS.OPENAI_RESPONSES:
          return projectResponses(
            route,
            metadata,
            target,
            'openai',
            'ai-sdk:openai-responses-part'
          );
        case AI_SDK_INFERENCE_CAPABILITY_IDS.XAI_RESPONSES:
          return projectResponses(route, metadata, target, 'xai', 'ai-sdk:xai-responses-part');
        default:
          throw new Error(
            `[AiSdkInference] ${route.capability_id} 不是已准入的 Responses continuation capability。`
          );
      }
    case 'anthropic_messages':
      return projectAnthropic(route, metadata, target);
    case 'google_generative_ai':
      return projectGoogle(route, metadata, target);
    case 'cohere_chat':
      // Cohere V2 的 thinking 不携带跨轮签名；有序文本与工具调用由 canonical history 回放。
      return undefined;
    case 'ollama_chat':
      // Ollama 原生 Chat 不提供跨轮 continuation token；由 canonical history 完整回放。
      return undefined;
  }
}
