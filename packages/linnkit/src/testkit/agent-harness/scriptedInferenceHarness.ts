import {
  LlmCaller,
  type LlmCallOptions,
  type ModelCatalogEntry,
  type ModelCatalogLike,
} from '../../runtime-kernel';
import type {
  CanonicalInferenceEvent,
  CanonicalInferenceFinishReason,
  CanonicalInferencePort,
  CanonicalInferenceRequest,
  LlmInputMaterializerPort,
  ProviderContinuation,
} from '../../ports';
import type { CanonicalLlmUsage } from '../../contracts';
import { toSerializableJsonRecord } from '../../contracts';

type ScriptedLlmCaller = LlmCaller;

export interface ScriptedLlmCall {
  readonly request: CanonicalInferenceRequest;
  readonly modelId: string;
  readonly messages: CanonicalInferenceRequest['messages'];
  readonly options: LlmCallOptions;
}

export interface ScriptedToolCall {
  id: string;
  name: string;
  argumentsJson: string;
  index?: number;
  continuations?: ProviderContinuation[];
}

export interface ScriptedLlmTurn {
  thoughtDeltas?: string[];
  contentChunks?: string[];
  toolCalls?: ScriptedToolCall[];
  textContinuations?: ProviderContinuation[];
  reasoningContinuations?: ProviderContinuation[];
  canonicalUsage?: CanonicalLlmUsage;
  finishReason?: CanonicalInferenceFinishReason;
  failure?: {
    kind: 'aborted' | 'transport' | 'provider' | 'protocol';
    code: string;
    retryable: boolean;
  };
  throwAfterEvents?: string | Error;
  assertCall?: (call: ScriptedLlmCall) => void;
}

export interface ScriptedInferenceHarness {
  getCalls(): ScriptedLlmCall[];
  getConsumedTurnCount(): number;
  getLlmCaller(): ScriptedLlmCaller;
  assertAllTurnsConsumed(): void;
}

export interface ScriptedInferenceHarnessOptions {
  modelCatalog?: ModelCatalogLike;
  llmInputMaterializer?: LlmInputMaterializerPort;
}

function toError(input: string | Error): Error {
  return typeof input === 'string' ? new Error(input) : input;
}

function callOptions(request: CanonicalInferenceRequest): LlmCallOptions {
  return {
    tools: [...request.tools],
    tool_choice: request.tool_choice,
    ...(request.sampling.temperature !== undefined
      ? { temperature: request.sampling.temperature }
      : {}),
    ...(request.sampling.top_p !== undefined ? { top_p: request.sampling.top_p } : {}),
    ...(request.sampling.max_output_tokens !== undefined
      ? { max_tokens: request.sampling.max_output_tokens }
      : {}),
    ...(request.sampling.reasoning_effort !== undefined
      ? {
          reasoning_effort:
            request.sampling.reasoning_effort === 'none'
              ? 'off' as const
              : request.sampling.reasoning_effort,
        }
      : {}),
  };
}

function createScriptedModelCatalog(): ModelCatalogLike {
  const entry = (id: string): ModelCatalogEntry => ({
    id,
    enabled: true,
    capabilities: ['chat'],
    adapter_input_support: { user_image: false, tool_result_image: false },
  });
  return {
    getModelById: entry,
    getModelsByCapability: () => [],
    getModelsByUIVisibility: () => [],
  };
}

function parseArguments(toolCall: ScriptedToolCall) {
  const parsed: unknown = JSON.parse(toolCall.argumentsJson);
  const record = toSerializableJsonRecord(parsed);
  if (!record) {
    throw new Error(`[scriptedInferenceHarness] ${toolCall.name} arguments 必须是 JSON object。`);
  }
  return record;
}

export function createScriptedInferenceHarness(
  turns: ScriptedLlmTurn[],
  options: ScriptedInferenceHarnessOptions = {},
): ScriptedInferenceHarness {
  const streamTurns = [...turns];
  const calls: ScriptedLlmCall[] = [];

  const inferencePort: CanonicalInferencePort = {
    async *stream(request): AsyncIterable<CanonicalInferenceEvent> {
      const turn = streamTurns.shift();
      if (!turn) {
        throw new Error('[scriptedInferenceHarness] 没有可消费的 scripted turn，请补齐脚本。');
      }
      const call: ScriptedLlmCall = {
        request,
        modelId: request.model_id,
        messages: request.messages,
        options: callOptions(request),
      };
      calls.push(call);
      turn.assertCall?.(call);

      yield { type: 'start', model_id: request.model_id, attempt_id: request.invocation.attempt_id };
      if (turn.failure) {
        yield { type: 'failure', ...turn.failure };
        return;
      }
      let nextAssistantPartIndex = 0;
      for (const thought of turn.thoughtDeltas ?? []) {
        yield { type: 'thought_delta', text: thought };
      }
      if (turn.thoughtDeltas?.length) {
        yield {
          type: 'assistant_part_end',
          index: nextAssistantPartIndex++,
          part: {
            type: 'reasoning',
            text: turn.thoughtDeltas.join(''),
            ...(turn.reasoningContinuations?.length
              ? { continuation: turn.reasoningContinuations }
              : {}),
          },
        };
      }
      for (const chunk of turn.contentChunks ?? []) {
        yield { type: 'answer_delta', text: chunk };
      }
      if (turn.contentChunks?.length) {
        yield {
          type: 'assistant_part_end',
          index: nextAssistantPartIndex++,
          part: {
            type: 'text',
            text: turn.contentChunks.join(''),
            ...(turn.textContinuations?.length
              ? { continuation: turn.textContinuations }
              : {}),
          },
        };
      }
      for (const [position, toolCall] of (turn.toolCalls ?? []).entries()) {
        const index = toolCall.index ?? position;
        yield {
          type: 'tool_call_start',
          index,
          part_index: nextAssistantPartIndex++,
          id: toolCall.id,
          name: toolCall.name,
        };
        yield {
          type: 'tool_argument_delta',
          index,
          json_delta: toolCall.argumentsJson,
        };
        yield {
          type: 'tool_call_end',
          index,
          call: {
            id: toolCall.id,
            name: toolCall.name,
            arguments: parseArguments(toolCall),
            ...(toolCall.continuations?.length
              ? { continuation: toolCall.continuations }
              : {}),
          },
        };
      }
      if (turn.canonicalUsage) {
        yield { type: 'usage', usage: turn.canonicalUsage };
      }
      if (request.signal?.aborted) {
        yield { type: 'failure', kind: 'aborted', code: 'request_aborted', retryable: false };
        return;
      }
      if (turn.throwAfterEvents) throw toError(turn.throwAfterEvents);
      yield { type: 'finish', reason: turn.finishReason ?? 'stop' };
    },
  };

  const llmCaller = new LlmCaller({
    inferencePort,
    modelCatalog: options.modelCatalog ?? createScriptedModelCatalog(),
    llmInputMaterializer: options.llmInputMaterializer,
  });

  return {
    getCalls: () => [...calls],
    getConsumedTurnCount: () => calls.length,
    getLlmCaller: () => llmCaller,
    assertAllTurnsConsumed(): void {
      if (streamTurns.length > 0) {
        throw new Error(
          `[scriptedInferenceHarness] 仍有 ${streamTurns.length} 个 scripted turn 未被消费，请检查图执行是否提前结束。`
        );
      }
    },
  };
}
