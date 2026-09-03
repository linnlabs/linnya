import { describe, expect, it } from 'vitest';
import type {
  CanonicalInferenceEvent,
  CanonicalInferencePort,
  CanonicalInferenceRequest,
} from '@linnlabs/linnkit/ports';
import { TextGenerationFailure } from 'src/domains/model-inference';
import { InferenceAdmissionError } from '../definitions/inferenceAdmissionError';
import { createTextGenerationPort } from './createTextGenerationPort';

function scriptedPort(
  events: readonly CanonicalInferenceEvent[],
  requests: CanonicalInferenceRequest[] = []
): CanonicalInferencePort {
  return {
    async *stream(request) {
      requests.push(request);
      yield* events;
    },
  };
}

describe('Text generation Host adapter', () => {
  it('把窄请求投影为 canonical inference，并返回正文、推理和原始 usage', async () => {
    const requests: CanonicalInferenceRequest[] = [];
    const usage = {
      inputTokens: 12,
      outputTokens: 4,
      reasoningTokens: 2,
      totalTokens: 16,
      source: 'provider-response-usage' as const,
      confidence: 'actual' as const,
      rawUsage: { prompt_tokens: 12, completion_tokens: 4 },
    };
    const port = createTextGenerationPort({
      inferencePort: scriptedPort([
        { type: 'start', model_id: 'vision-model', attempt_id: 'invocation-2' },
        { type: 'thought_delta', text: '观察图片' },
        { type: 'answer_delta', text: '识别结果' },
        { type: 'usage', usage },
        { type: 'finish', reason: 'stop' },
      ], requests),
      createInvocationId: (() => {
        let sequence = 0;
        return () => `invocation-${++sequence}`;
      })(),
    });

    await expect(port.generate({
      modelId: 'vision-model',
      messages: [
        { role: 'system', content: '识别图片' },
        {
          role: 'user',
          content: [{ type: 'image', mediaType: 'image/png', bytes: new Uint8Array([1, 2]) }],
        },
      ],
      temperature: 0.1,
      maxOutputTokens: 1_024,
    })).resolves.toEqual({
      text: '识别结果',
      reasoning: '观察图片',
      finishReason: 'stop',
      usage,
    });
    expect(requests).toEqual([{
      model_id: 'vision-model',
      messages: [
        { role: 'system', content: '识别图片' },
        {
          role: 'user',
          content: [{
            type: 'image',
            media_type: 'image/png',
            bytes: new Uint8Array([1, 2]),
          }],
        },
      ],
      tools: [],
      tool_choice: 'none',
      sampling: {
        temperature: 0.1,
        top_p: undefined,
        max_output_tokens: 1_024,
        reasoning_effort: undefined,
      },
      signal: undefined,
      invocation: { trace_id: 'invocation-1', attempt_id: 'invocation-2' },
    }]);
  });

  it('保留 Provider failure 的分类、编码和可重试语义', async () => {
    const port = createTextGenerationPort({
      inferencePort: scriptedPort([{
        type: 'failure',
        kind: 'provider',
        code: 'provider_http_429',
        retryable: true,
      }]),
    });

    await expect(port.generate({
      modelId: 'vision-model',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    })).rejects.toMatchObject({
      name: 'TextGenerationFailure',
      kind: 'provider',
      code: 'provider_http_429',
      retryable: true,
    });
  });

  it('缺少 finish 终态时拒绝返回不完整结果', async () => {
    const port = createTextGenerationPort({
      inferencePort: scriptedPort([{ type: 'answer_delta', text: 'partial' }]),
    });

    await expect(port.generate({
      modelId: 'vision-model',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    })).rejects.toMatchObject({
      kind: 'protocol',
      code: 'missing_finish_event',
      retryable: false,
    });
  });

  it('把 Host admission failure 收窄为不可重试的文本生成失败', async () => {
    const port = createTextGenerationPort({
      inferencePort: {
        async *stream() {
          throw new InferenceAdmissionError('inference.credential_invalid', 'credential invalid');
        },
      },
    });

    await expect(port.generate({
      modelId: 'vision-model',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    })).rejects.toMatchObject({
      kind: 'protocol',
      code: 'inference.credential_invalid',
      retryable: false,
    });
  });
});
