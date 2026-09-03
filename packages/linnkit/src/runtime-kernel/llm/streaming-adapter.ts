import {
  generateAnswerSegmentId,
  generateInferenceAttemptId,
  generateRuntimeEventId,
  ToolCallIdSchema,
  type AssistantReplayPart,
  type CanonicalLlmUsage,
  type ProviderContinuation,
  type ToolCallId,
} from '../../contracts';
import type {
  CanonicalInferenceEvent,
  CanonicalInferenceFailureKind,
  CanonicalInferencePort,
  ResolvedLlmInputMessage,
} from '../../ports';
import type { AnyAgentEvent } from '../events/agentEvents';
import type { ToolCallStreamingPolicy } from '../tools/toolContracts';
import type { LlmCallOptions, ToolCall } from './caller.types';
import { consumeCanonicalInferenceStream } from './canonical-inference';
import { buildCanonicalInferenceRequest } from './canonical-inference/functions/buildCanonicalInferenceRequest';
import { createLlmAgentErrorEvent } from './functions/createLlmAgentErrorEvent';
import { LlmIncompleteOutputError } from './definitions/llmIncompleteOutputError';
import { ThoughtStreamSegmenter } from './streaming/thoughtStreamSegmenter';
import { ErrorClassifier, type ErrorClassification } from '../../shared/errorClassifier';
import { Logger } from '../../shared/logger';
import type { LlmCallResult } from './usage-telemetry';

const logger = new Logger('LlmCaller');

class CanonicalInferenceFailureError extends Error {
  readonly errorCode: string;
  readonly recoverable: boolean;
  readonly metadata: Record<string, unknown>;

  constructor(failure: {
    readonly kind: CanonicalInferenceFailureKind;
    readonly code: string;
    readonly retryable: boolean;
  }, abortReason?: unknown) {
    const message = failure.kind === 'aborted' && typeof abortReason === 'string'
      ? abortReason
      : failure.kind === 'aborted' && abortReason instanceof Error
        ? abortReason.message
        : `Canonical inference failed: ${failure.code}`;
    super(message);
    this.name = failure.kind === 'aborted' ? 'AbortError' : 'CanonicalInferenceFailureError';
    this.errorCode = `llm.${failure.code}`;
    this.recoverable = failure.retryable;
    this.metadata = { failure_kind: failure.kind, provider_code: failure.code };
  }
}

interface OpenToolCall {
  readonly partIndex: number;
  readonly id?: string;
  readonly name?: string;
  json: string;
  lastSnapshot?: string;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export interface CallLlmStreamParams {
  inferencePort: CanonicalInferencePort;
  modelId: string;
  messages: ResolvedLlmInputMessage[];
  options?: LlmCallOptions;
  eventHandler?: (event: AnyAgentEvent) => void;
  onErrorClassification?: (classification: ErrorClassification) => void;
  signal?: AbortSignal;
  toolCallStreamingPolicies?: Readonly<Record<string, ToolCallStreamingPolicy>>;
  traceId?: string;
}

export async function callLlmStream(params: CallLlmStreamParams): Promise<LlmCallResult> {
  const {
    inferencePort,
    modelId,
    messages,
    options = {},
    eventHandler,
    onErrorClassification,
    signal,
    toolCallStreamingPolicies = {},
    traceId,
  } = params;
  const attemptId = generateInferenceAttemptId();
  const streamAnswerId = generateAnswerSegmentId();
  const thoughtSegmenter = new ThoughtStreamSegmenter();
  const openToolCalls = new Map<number, OpenToolCall>();
  const completedToolCalls = new Map<number, ToolCall>();
  const emittedPlaceholderIds = new Set<string>();
  let fullResponse = '';
  let streamChunkSeq = 0;
  const providerContinuations: ProviderContinuation[] = [];
  const assistantReplayParts = new Map<number, AssistantReplayPart>();
  let canonicalUsage: CanonicalLlmUsage | undefined;

  const emit = (event: AnyAgentEvent): void => eventHandler?.(event);
  const appendContinuations = (continuations: readonly ProviderContinuation[]): void => {
    if (continuations.length > 0) {
      providerContinuations.push(...continuations);
      emit({
        type: 'provider_continuation',
        id: generateRuntimeEventId(),
        timestamp: Date.now(),
        continuations: [...continuations],
      });
    }
  };
  const emitThoughtComplete = (completed: ReturnType<ThoughtStreamSegmenter['finalize']>): void => {
    if (!completed) return;
    emit({
      type: 'thought',
      thought_message_id: completed.thoughtMessageId,
      id: generateRuntimeEventId(),
      timestamp: completed.timestamp,
      content: completed.content,
      is_complete: true,
      meta: {
        thought_started_at: completed.thoughtStartedAt,
        thought_completed_at: completed.thoughtCompletedAt,
      },
    });
  };

  const emitPlaceholder = (id: string, name: string): void => {
    if (toolCallStreamingPolicies[name]?.emitPlaceholder !== true) return;
    if (emittedPlaceholderIds.has(id)) return;
    emittedPlaceholderIds.add(id);
    const toolCallId: ToolCallId = ToolCallIdSchema.parse(id);
    emit({
      type: 'tool_process',
      id: generateRuntimeEventId(),
      timestamp: Date.now(),
      tool_name: name,
      tool_args: {},
      tool_call_id: toolCallId,
      phase: 'start',
      status: 'loading',
      payload: { args: {} },
      meta: { ephemeral: true },
    });
  };

  const emitArgumentSnapshot = (toolCall: OpenToolCall): void => {
    if (!toolCall.id || !toolCall.name) return;
    if (toolCallStreamingPolicies[toolCall.name]?.emitArgumentSnapshots !== true) return;
    if (!toolCall.json || toolCall.lastSnapshot === toolCall.json) return;
    const parsed: unknown = JSON.parse(toolCall.json);
    if (!isUnknownRecord(parsed)) return;
    toolCall.lastSnapshot = toolCall.json;
    const toolCallId: ToolCallId = ToolCallIdSchema.parse(toolCall.id);
    emit({
      type: 'tool_process',
      id: generateRuntimeEventId(),
      timestamp: Date.now(),
      tool_name: toolCall.name,
      tool_args: parsed,
      tool_call_id: toolCallId,
      phase: 'update',
      status: 'loading',
      payload: { args: parsed },
      meta: { ephemeral: true },
    });
  };

  const handleEvent = (event: CanonicalInferenceEvent): void => {
    switch (event.type) {
      case 'start':
      case 'finish':
      case 'failure':
        return;
      case 'answer_delta':
        emitThoughtComplete(thoughtSegmenter.onBoundary());
        fullResponse += event.text;
        emit({
          type: 'stream_chunk',
          timestamp: Date.now(),
          content: event.text,
          id: generateRuntimeEventId(),
          answer_id: streamAnswerId,
          seq: streamChunkSeq++,
        });
        return;
      case 'thought_delta': {
        const delta = thoughtSegmenter.onThoughtDelta(event.text);
        if (!delta) return;
        emit({
          type: 'thought',
          thought_message_id: delta.thoughtMessageId,
          id: generateRuntimeEventId(),
          timestamp: delta.timestamp,
          content: '',
          delta: delta.delta,
          is_complete: false,
          meta: { thought_started_at: delta.thoughtStartedAt },
        });
        return;
      }
      case 'tool_call_start': {
        emitThoughtComplete(thoughtSegmenter.onBoundary());
        const openToolCall: OpenToolCall = {
          partIndex: event.part_index,
          id: event.id,
          name: event.name,
          json: '',
        };
        openToolCalls.set(event.index, openToolCall);
        if (event.id && event.name) emitPlaceholder(event.id, event.name);
        return;
      }
      case 'tool_argument_delta': {
        const openToolCall = openToolCalls.get(event.index);
        if (!openToolCall) return;
        openToolCall.json += event.json_delta;
        try {
          emitArgumentSnapshot(openToolCall);
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
        }
        return;
      }
      case 'tool_call_end':
        emitPlaceholder(event.call.id, event.call.name);
        completedToolCalls.set(event.index, {
          id: event.call.id,
          type: 'function',
          function: {
            name: event.call.name,
            arguments: JSON.stringify(event.call.arguments),
          },
        });
        const completedOpenToolCall = openToolCalls.get(event.index);
        if (!completedOpenToolCall) {
          throw new Error(`[CanonicalInference] tool index ${event.index} 缺少 open state。`);
        }
        assistantReplayParts.set(completedOpenToolCall.partIndex, {
          type: 'tool_call',
          tool_call_id: event.call.id,
          ...(event.call.continuation?.length
            ? { provider_continuations: [...event.call.continuation] }
            : {}),
        });
        if (event.call.continuation?.length) appendContinuations(event.call.continuation);
        openToolCalls.delete(event.index);
        return;
      case 'assistant_part_end': {
        const continuations = event.part.continuation ?? [];
        assistantReplayParts.set(event.index, {
          type: event.part.type,
          text: event.part.text,
          ...(continuations.length
            ? { provider_continuations: [...continuations] }
            : {}),
        });
        if (continuations.length) appendContinuations(continuations);
        return;
      }
      case 'usage':
        canonicalUsage = event.usage;
        return;
    }
  };

  try {
    const terminal = await consumeCanonicalInferenceStream(
      inferencePort.stream(buildCanonicalInferenceRequest({
        model_id: modelId,
        messages,
        options,
        signal,
        trace_id: traceId,
        attempt_id: attemptId,
      })),
      handleEvent
    );
    if (terminal.type === 'failure') {
      throw new CanonicalInferenceFailureError(terminal, signal?.reason);
    }
    if (terminal.reason === 'length' || terminal.reason === 'content_filter') {
      throw new LlmIncompleteOutputError(terminal.reason);
    }
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    if (normalized.name === 'AbortError') {
      logger.info('Canonical inference 收到取消终态，不发布普通 error event', { modelId });
      throw normalized;
    }
    const classification = ErrorClassifier.classify(normalized, {
      logPrefix: '[LlmCaller:canonical-stream]',
    });
    onErrorClassification?.(classification);
    emit(createLlmAgentErrorEvent(normalized, classification));
    throw normalized;
  } finally {
    emitThoughtComplete(thoughtSegmenter.finalize());
  }

  const toolCalls = [...completedToolCalls.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, toolCall]) => toolCall);
  return {
    content: fullResponse,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    ...(providerContinuations.length > 0
      ? { provider_continuations: providerContinuations }
      : {}),
    ...(assistantReplayParts.size > 0
      ? {
          assistant_replay_parts: [...assistantReplayParts.entries()]
            .sort(([left], [right]) => left - right)
            .map(([, part]) => part),
        }
      : {}),
    ...(canonicalUsage ? { canonicalUsage } : {}),
  };
}
