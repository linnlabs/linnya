import {
  generateInferenceAttemptId,
  generateTraceId,
  AssistantReplayParts,
  ProviderContinuations,
  toSerializableJsonRecord,
} from '../../../../contracts';
import type {
  CanonicalInferenceContentBlock,
  CanonicalAssistantReplayPart,
  CanonicalInferenceMessage,
  CanonicalInferenceRequest,
  ResolvedLlmImageAttachment,
  ResolvedLlmInputMessage,
} from '../../../../ports';
import type { LlmCallOptions, ToolCall } from '../../caller.types';
import { isRecord, toToolCalls } from '../../sidecar-replay';

function imageBlock(
  attachment: ResolvedLlmImageAttachment
): Extract<CanonicalInferenceContentBlock, { type: 'image' }> {
  return {
    type: 'image',
    media_type: attachment.mediaType,
    bytes: attachment.bytes,
  };
}

function contentBlocks(
  content: string,
  attachments: readonly ResolvedLlmImageAttachment[] | undefined
): CanonicalInferenceContentBlock[] {
  return [
    ...(content ? [{ type: 'text' as const, text: content }] : []),
    ...(attachments ?? []).map(imageBlock),
  ];
}

function readProviderContinuations(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return ProviderContinuations.parse(value);
}

function resolvedAttachment(value: unknown): ResolvedLlmImageAttachment {
  if (!isRecord(value)) {
    throw new Error('[CanonicalInference] resolved image attachment 必须是对象。');
  }
  const mediaType = value['mediaType'];
  const placement = value['placement'];
  const bytes = value['bytes'];
  if (
    typeof value['id'] !== 'string' ||
    typeof value['resourceId'] !== 'string' ||
    (mediaType !== 'image/jpeg' && mediaType !== 'image/png' && mediaType !== 'image/webp') ||
    typeof value['byteLength'] !== 'number' ||
    typeof value['width'] !== 'number' ||
    typeof value['height'] !== 'number' ||
    (placement !== 'user_image' && placement !== 'tool_result_image') ||
    !(bytes instanceof Uint8Array)
  ) {
    throw new Error('[CanonicalInference] resolved image attachment 合同无效。');
  }
  return {
    id: value['id'],
    resourceId: value['resourceId'],
    mediaType,
    byteLength: value['byteLength'],
    width: value['width'],
    height: value['height'],
    placement,
    bytes,
  };
}

function completedToolCall(call: ToolCall) {
  const parsedInput: unknown = JSON.parse(call.function.arguments);
  const argumentsRecord = toSerializableJsonRecord(parsedInput);
  if (!argumentsRecord) {
    throw new Error(`Invalid tool_call.arguments: ${call.function.name}(${call.id}) 必须是 JSON object。`);
  }
  return { id: call.id, name: call.function.name, arguments: argumentsRecord };
}

function assistantMessage(message: unknown): CanonicalInferenceMessage {
  if (!isRecord(message)) {
    throw new Error('[CanonicalInference] assistant message 必须是对象。');
  }
  const record = message;
  const content = typeof record['content'] === 'string' ? record['content'] : '';
  const toolCalls = toToolCalls(record['tool_calls']);
  const completedCalls = (toolCalls ?? []).map(completedToolCall);
  const callsById = new Map(completedCalls.map(call => [call.id, call]));
  const metadata = isRecord(record['metadata']) ? record['metadata'] : undefined;
  const continuation = readProviderContinuations(
    record['provider_continuations'] ??
    metadata?.['provider_continuations']
  );
  const durableParts = record['assistant_replay_parts'] ?? metadata?.['assistant_replay_parts'];
  if (durableParts !== undefined) {
    const parts: CanonicalAssistantReplayPart[] = AssistantReplayParts.parse(durableParts)
      .map(part => {
        if (part.type !== 'tool_call') {
          return {
            type: part.type,
            text: part.text,
            ...(part.provider_continuations
              ? { continuation: part.provider_continuations }
              : {}),
          };
        }
        const call = callsById.get(part.tool_call_id);
        if (!call) {
          throw new Error(
            `[CanonicalInference] assistant replay part 找不到 tool call: ${part.tool_call_id}`
          );
        }
        return {
          type: 'tool_call',
          call: {
            ...call,
            ...(part.provider_continuations
              ? { continuation: part.provider_continuations }
              : {}),
          },
        };
      });
    return { role: 'assistant', parts };
  }
  if (continuation) {
    throw new Error(
      `[CanonicalInference] Provider continuation 缺少 ordered assistant replay parts: ` +
      `message_id=${typeof record['id'] === 'string' ? record['id'] : 'unknown'}, ` +
      `message_type=${typeof record['type'] === 'string' ? record['type'] : 'unknown'}`
    );
  }
  return {
    role: 'assistant',
    parts: [
      ...(content ? [{ type: 'text' as const, text: content }] : []),
      ...completedCalls.map(call => ({ type: 'tool_call' as const, call })),
    ],
  };
}

function toolMessage(message: unknown): CanonicalInferenceMessage {
  if (!isRecord(message)) {
    throw new Error('[CanonicalInference] tool message 必须是对象。');
  }
  const metadata = isRecord(message['metadata']) ? message['metadata'] : undefined;
  const toolCallId = message['tool_call_id'] ?? metadata?.['tool_call_id'];
  if (typeof toolCallId !== 'string' || !toolCallId.trim()) {
    throw new Error('[CanonicalInference] tool message 缺少 tool_call_id。');
  }
  const content = message['content'];
  if (typeof content !== 'string') {
    throw new Error('[CanonicalInference] tool message content 必须是字符串。');
  }
  const attachments = Array.isArray(message['attachments'])
    ? message['attachments'].map(resolvedAttachment)
    : undefined;
  return {
    role: 'tool',
    tool_call_id: toolCallId,
    content: contentBlocks(content, attachments),
  };
}

function projectMessage(message: ResolvedLlmInputMessage): CanonicalInferenceMessage {
  if (message.role === 'assistant') return assistantMessage(message);
  if (message.role === 'system') return { role: 'system', content: message.content };
  if (message.role === 'user') {
    return {
      role: 'user',
      content: contentBlocks(message.content, 'attachments' in message ? message.attachments : undefined),
    };
  }
  return toolMessage(message);
}

function reasoningEffort(
  effort: LlmCallOptions['reasoning_effort']
): CanonicalInferenceRequest['sampling']['reasoning_effort'] {
  return effort === 'off' ? 'none' : effort;
}

export interface BuildCanonicalInferenceRequestInput {
  readonly model_id: string;
  readonly messages: readonly ResolvedLlmInputMessage[];
  readonly options: LlmCallOptions;
  readonly signal?: AbortSignal;
  readonly trace_id?: string;
  readonly attempt_id?: string;
}

export function buildCanonicalInferenceRequest(
  input: BuildCanonicalInferenceRequestInput
): CanonicalInferenceRequest {
  const effort = reasoningEffort(input.options.reasoning_effort);
  return {
    model_id: input.model_id,
    messages: input.messages.map(projectMessage),
    tools: input.options.tools ?? [],
    tool_choice: input.options.tool_choice ?? 'auto',
    ...(input.options.cache_policy ? { cache_policy: input.options.cache_policy } : {}),
    sampling: {
      ...(input.options.temperature !== undefined ? { temperature: input.options.temperature } : {}),
      ...(input.options.top_p !== undefined ? { top_p: input.options.top_p } : {}),
      ...(input.options.max_tokens !== undefined
        ? { max_output_tokens: input.options.max_tokens }
        : {}),
      ...(effort !== undefined ? { reasoning_effort: effort } : {}),
    },
    ...(input.signal ? { signal: input.signal } : {}),
    invocation: {
      trace_id: input.trace_id ?? generateTraceId(),
      attempt_id: input.attempt_id ?? generateInferenceAttemptId(),
    },
  };
}
