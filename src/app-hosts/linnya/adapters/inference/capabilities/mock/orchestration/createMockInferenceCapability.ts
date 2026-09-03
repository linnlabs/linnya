import { generateToolCallId, toSerializableJsonRecord } from '@linnlabs/linnkit/contracts';
import type { CanonicalInferenceEvent } from '@linnlabs/linnkit/ports';
import {
  resolveMockInferenceConfig,
  splitMockInferenceText,
} from '../functions/resolveMockInferenceConfig';
import { buildMockToolArguments } from '../functions/buildMockToolArguments';
import type { InferenceCapability } from '../../../definitions/inferenceCapability';

export const MOCK_INFERENCE_CAPABILITY_ID = 'host:mock';

function delay(ms: number): Promise<void> {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}

async function* textEvents(
  type: 'answer_delta' | 'thought_delta',
  text: string,
  chunkSize: number,
  delayMs: number,
  signal: AbortSignal | undefined
): AsyncIterable<CanonicalInferenceEvent> {
  for (const chunk of splitMockInferenceText(text, chunkSize)) {
    if (signal?.aborted) {
      return;
    }
    yield { type, text: chunk };
    await delay(delayMs);
  }
}

export function createMockInferenceCapability(): InferenceCapability {
  return {
    id: MOCK_INFERENCE_CAPABILITY_ID,
    api_surface: 'mock',
    async *stream({ request, route }) {
      yield {
        type: 'start',
        model_id: request.model_id,
        attempt_id: request.invocation.attempt_id,
      };
      const config = resolveMockInferenceConfig(route.base_url);
      const hasToolResult = request.messages.some(message => message.role === 'tool');

      if (config.preset === 'tool_call' && !hasToolResult) {
        yield* textEvents(
          'thought_delta',
          config.thought,
          config.chunkSize,
          config.delayMs,
          request.signal
        );
        if (config.thought) {
          yield {
            type: 'assistant_part_end',
            index: 0,
            part: { type: 'reasoning', text: config.thought },
          };
        }
        if (request.signal?.aborted) {
          yield { type: 'failure', kind: 'aborted', code: 'request_aborted', retryable: false };
          return;
        }
        const tool = request.tools.find(candidate => candidate.name === config.toolName);
        if (!tool) {
          yield {
            type: 'failure',
            kind: 'protocol',
            code: 'mock_tool_not_registered',
            retryable: false,
          };
          return;
        }
        const argumentsRecord = toSerializableJsonRecord(
          buildMockToolArguments(tool.parameters)
        );
        if (!argumentsRecord) {
          yield {
            type: 'failure',
            kind: 'protocol',
            code: 'mock_tool_arguments_invalid',
            retryable: false,
          };
          return;
        }
        const id = generateToolCallId();
        const json = JSON.stringify(argumentsRecord);
        yield { type: 'tool_call_start', index: 0, part_index: 1, id, name: tool.name };
        for (const chunk of splitMockInferenceText(json, Math.min(config.chunkSize, 60))) {
          yield { type: 'tool_argument_delta', index: 0, json_delta: chunk };
        }
        yield {
          type: 'tool_call_end',
          index: 0,
          call: { id, name: tool.name, arguments: argumentsRecord },
        };
        yield { type: 'finish', reason: 'tool_use' };
        return;
      }

      yield* textEvents(
        'thought_delta',
        hasToolResult
          ? '### Mock 思考\n检测到工具输出，准备生成最终答案。\n'
          : config.thought,
        config.chunkSize,
        config.delayMs,
        request.signal
      );
      const reasoningText = hasToolResult
        ? '### Mock 思考\n检测到工具输出，准备生成最终答案。\n'
        : config.thought;
      if (reasoningText) {
        yield {
          type: 'assistant_part_end',
          index: 0,
          part: { type: 'reasoning', text: reasoningText },
        };
      }
      if (request.signal?.aborted) {
        yield { type: 'failure', kind: 'aborted', code: 'request_aborted', retryable: false };
        return;
      }
      yield* textEvents(
        'answer_delta',
        config.content,
        config.chunkSize,
        config.delayMs,
        request.signal
      );
      if (config.content) {
        yield {
          type: 'assistant_part_end',
          index: 1,
          part: { type: 'text', text: config.content },
        };
      }
      if (request.signal?.aborted) {
        yield { type: 'failure', kind: 'aborted', code: 'request_aborted', retryable: false };
        return;
      }
      yield { type: 'finish', reason: 'stop' };
    },
  };
}
