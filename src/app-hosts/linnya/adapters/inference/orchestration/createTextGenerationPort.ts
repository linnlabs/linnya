import { randomUUID } from 'node:crypto';
import type {
  CanonicalInferenceMessage,
  CanonicalInferencePort,
  CanonicalInferenceRequest,
} from 'linnkit/ports';
import {
  TextGenerationFailure,
  type TextGenerationFinishReason,
  type TextGenerationMessage,
  type TextGenerationPort,
  type TextGenerationResult,
  validateTextGenerationRequest,
} from 'src/domains/model-inference';
import { InferenceAdmissionError } from '../definitions/inferenceAdmissionError';

export interface TextGenerationPortDependencies {
  readonly inferencePort: CanonicalInferencePort;
  readonly createInvocationId?: () => string;
}

function projectMessages(
  messages: readonly TextGenerationMessage[]
): readonly CanonicalInferenceMessage[] {
  return messages.map(message => {
    if (message.role === 'system') return message;
    return {
      role: 'user',
      content: message.content.map(block => block.type === 'text'
        ? block
        : {
            type: 'image',
            media_type: block.mediaType,
            bytes: block.bytes,
          }),
    };
  });
}

function assertNever(value: never): never {
  throw new Error(`未处理的 canonical inference event: ${String(value)}`);
}

function rejectToolEvent(eventType: string): never {
  throw new TextGenerationFailure(
    'protocol',
    'unexpected_tool_event',
    false,
    `Text generation 不接受工具事件: ${eventType}`
  );
}

async function generateText(
  dependencies: Required<TextGenerationPortDependencies>,
  request: Parameters<TextGenerationPort['generate']>[0]
): Promise<TextGenerationResult> {
  validateTextGenerationRequest(request);
  const canonicalRequest: CanonicalInferenceRequest = {
    model_id: request.modelId,
    messages: projectMessages(request.messages),
    tools: [],
    tool_choice: 'none',
    sampling: {
      temperature: request.temperature,
      top_p: request.topP,
      max_output_tokens: request.maxOutputTokens,
      reasoning_effort: request.reasoningEffort,
    },
    signal: request.signal,
    invocation: {
      trace_id: dependencies.createInvocationId(),
      attempt_id: dependencies.createInvocationId(),
    },
  };

  let text = '';
  let reasoning = '';
  let usage: TextGenerationResult['usage'];
  let finishReason: TextGenerationFinishReason | undefined;

  try {
    for await (const event of dependencies.inferencePort.stream(canonicalRequest)) {
      switch (event.type) {
        case 'start':
        case 'assistant_part_end':
          break;
        case 'answer_delta':
          text += event.text;
          break;
        case 'thought_delta':
          reasoning += event.text;
          break;
        case 'usage':
          usage = event.usage;
          break;
        case 'finish':
          if (event.reason === 'tool_use') rejectToolEvent('finish:tool_use');
          finishReason = event.reason;
          break;
        case 'failure':
          throw new TextGenerationFailure(
            event.kind,
            event.code,
            event.retryable,
            `Text generation 失败: ${event.code}`
          );
        case 'tool_call_start':
        case 'tool_argument_delta':
        case 'tool_call_end':
          rejectToolEvent(event.type);
          break;
        default:
          assertNever(event);
      }
    }
  } catch (error) {
    if (error instanceof TextGenerationFailure) throw error;
    if (error instanceof InferenceAdmissionError) {
      throw new TextGenerationFailure('protocol', error.code, false, error.message);
    }
    throw error;
  }

  if (!finishReason) {
    throw new TextGenerationFailure(
      'protocol',
      'missing_finish_event',
      false,
      'Text generation stream 缺少 finish 事件'
    );
  }

  return { text, reasoning, finishReason, usage };
}

/**
 * 把 Host canonical inference 收窄为非 Agent 文本生成能力。
 * 重试、降级和业务提示词属于调用方 feature，本适配器只完成一次调用与结果投影。
 */
export function createTextGenerationPort(
  dependencies: TextGenerationPortDependencies
): TextGenerationPort {
  const resolvedDependencies: Required<TextGenerationPortDependencies> = {
    inferencePort: dependencies.inferencePort,
    createInvocationId: dependencies.createInvocationId ?? randomUUID,
  };
  return {
    generate: request => generateText(resolvedDependencies, request),
  };
}
