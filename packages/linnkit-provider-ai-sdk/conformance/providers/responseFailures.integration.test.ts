import type { CanonicalInferenceEvent } from '@linnlabs/linnkit/ports';
import { describe, expect, it } from 'vitest';
import {
  createAiSdkInferenceCapability,
  createAiSdkLanguageModelRegistry,
  type AiSdkLanguageDiagnostic,
} from '@linnlabs/linnkit-provider-ai-sdk';
import {
  providerSurfaceEventStream,
  providerSurfaceInvocation,
  providerSurfaceRoute,
} from '../fixtures/providerSurfaceCodecFixture';

const partial = {
  id: 'fixture-response',
  created: 1,
  model: 'fixture-model',
  choices: [{ index: 0, delta: { content: 'incomplete private answer' }, finish_reason: null }],
};
const complete = {
  ...partial,
  choices: [{ index: 0, delta: { content: 'complete answer' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 },
};

function brokenBody(): Response {
  let sent = false;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) {
          controller.error(new TypeError('sensitive socket detail'));
        } else {
          sent = true;
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(partial)}\n\n`));
        }
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } }
  );
}

interface FailureFixture {
  readonly name: string;
  readonly response: () => Response;
  readonly code: string;
  readonly deepseek_code?: string;
  readonly retryable: boolean;
}

const fixtures: readonly FailureFixture[] = [
  {
    name: '标准上游超时',
    response: () =>
      providerSurfaceEventStream(
        [
          JSON.stringify({
            error: {
              message: 'sensitive timeout detail',
              type: 'timeout_error',
              code: 'timeout',
            },
          }),
        ],
        true
      ),
    // DeepSeek SDK 已将标准 timeout 推断为 HTTP504；保留该上游事实，不强制抹平。
    code: 'provider_stream_timeout',
    deepseek_code: 'provider_http_504',
    retryable: true,
  },
  {
    name: '超时错误缺少 message',
    response: () =>
      providerSurfaceEventStream(
        [
          JSON.stringify({
            error: {
              type: 'timeout_error',
              code: 'timeout',
            },
          }),
        ],
        true
      ),
    code: 'provider_stream_timeout',
    retryable: true,
  },
  {
    name: '限流错误缺少 message',
    response: () =>
      providerSurfaceEventStream(
        [
          JSON.stringify({
            error: {
              type: 'rate_limit_error',
              code: 'rate_limit_exceeded',
            },
          }),
        ],
        true
      ),
    code: 'provider_stream_rate_limited',
    retryable: true,
  },
  {
    name: '真正不兼容的 content 字段',
    response: () =>
      providerSurfaceEventStream(
        [
          JSON.stringify({
            choices: [{ delta: { content: 123 }, finish_reason: null }],
          }),
        ],
        true
      ),
    code: 'provider_response_schema_invalid',
    retryable: false,
  },
  {
    name: 'HTTP200后读取失败',
    response: brokenBody,
    code: 'provider_response_read_error',
    retryable: true,
  },
];

describe.each(['ai-sdk:openai-compatible', 'ai-sdk:deepseek'] as const)(
  '%s 的真实响应失败 codec',
  capabilityId => {
    it.each(fixtures)('$name 保留重试语义，单attempt不偷偷重发', async fixture => {
      let requests = 0;
      const diagnostics: AiSdkLanguageDiagnostic[] = [];
      const route = providerSurfaceRoute(capabilityId, 'openai_chat_completions', 'bearer');
      const capability = createAiSdkInferenceCapability(capabilityId, route.surface, {
        language_models: createAiSdkLanguageModelRegistry(async () => {
          requests += 1;
          return requests === 1
            ? fixture.response()
            : providerSurfaceEventStream([JSON.stringify(complete)], true);
        }),
        diagnostic_sink: { publish: diagnostic => diagnostics.push(diagnostic) },
      });

      const failed: CanonicalInferenceEvent[] = [];
      for await (const event of capability.stream(providerSurfaceInvocation(route))) {
        failed.push(event);
        // 真实 Host 在终态就停止消费，finally 里的诊断仍必须完整。
        if (event.type === 'finish' || event.type === 'failure') break;
      }
      expect(requests).toBe(1);
      expect(failed.filter(event => event.type === 'finish' || event.type === 'failure')).toEqual([
        expect.objectContaining({
          type: 'failure',
          code:
            capabilityId === 'ai-sdk:deepseek'
              ? (fixture.deepseek_code ?? fixture.code)
              : fixture.code,
          retryable: fixture.retryable,
        }),
      ]);
      expect(diagnostics.at(-1)).toMatchObject({
        type: 'attempt_observed',
        terminal_event_received: true,
        terminal_event_type: 'failure',
      });
      expect(JSON.stringify(diagnostics)).not.toMatch(/sensitive|private answer|fixture-secret/);

      if (!fixture.retryable) return;
      // 只有调用方显式创建下一attempt才发第二次，不让SDK与框架叠加重试。
      const next = providerSurfaceInvocation(route);
      const success: CanonicalInferenceEvent[] = [];
      for await (const event of capability.stream({
        ...next,
        request: {
          ...next.request,
          invocation: { ...next.request.invocation, attempt_id: 'attempt-2' },
        },
      })) {
        success.push(event);
        if (event.type === 'finish' || event.type === 'failure') break;
      }
      expect(requests).toBe(2);
      expect(success.at(-1)).toEqual({ type: 'finish', reason: 'stop' });
      expect(diagnostics.at(-1)).toMatchObject({
        type: 'attempt_observed',
        retry_count: 1,
        terminal_event_received: true,
        terminal_event_type: 'finish',
      });
    });
  }
);

describe('compatible SDK 不完整流', () => {
  it.each([false, true])('有无DONE均不能把缺finish_reason的流当成功：DONE=%s', async done => {
    const route = providerSurfaceRoute(
      'ai-sdk:openai-compatible',
      'openai_chat_completions',
      'bearer'
    );
    const diagnostics: AiSdkLanguageDiagnostic[] = [];
    const capability = createAiSdkInferenceCapability(route.capability_id, route.surface, {
      language_models: createAiSdkLanguageModelRegistry(async () =>
        providerSurfaceEventStream([JSON.stringify(partial)], done)
      ),
      diagnostic_sink: { publish: diagnostic => diagnostics.push(diagnostic) },
    });
    const events: CanonicalInferenceEvent[] = [];
    for await (const event of capability.stream(providerSurfaceInvocation(route))) {
      events.push(event);
      if (event.type === 'finish' || event.type === 'failure') break;
    }
    expect(events.at(-1)).toEqual({
      type: 'failure',
      kind: 'transport',
      code: 'provider_stream_truncated',
      retryable: true,
    });
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        type: 'failure_projected',
        error_shape: 'invalid_response_data_error',
        sdk_error_details: { response_data_state: 'absent' },
      })
    );
  });
});
