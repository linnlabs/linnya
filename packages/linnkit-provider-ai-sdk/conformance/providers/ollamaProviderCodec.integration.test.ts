import { describe, expect, it } from 'vitest';
import {
  createAiSdkInferenceCapability,
  createAiSdkLanguageModelRegistry,
  type AiSdkLanguageDiagnostic,
} from '@linnlabs/linnkit-provider-ai-sdk';

import { route, runToolRoundTrip } from '../fixtures/dedicatedProviderCodecFixture';
import {
  collectProviderSurfaceEvents as collect,
  providerSurfaceInvocation as invocation,
  providerSurfaceRoute,
} from '../fixtures/providerSurfaceCodecFixture';

async function projectOllamaToolCall(toolName: string, toolArguments: unknown) {
  const resolvedRoute = providerSurfaceRoute('ai-sdk:ollama', 'ollama_chat', 'bearer');
  const diagnostics: AiSdkLanguageDiagnostic[] = [];
  let requestCount = 0;
  const fixtureFetch: typeof fetch = async () => {
    requestCount++;
    return new Response(`${JSON.stringify({
      model: resolvedRoute.endpoint_model_id,
      created_at: '2026-09-04T00:00:00.000Z',
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name: toolName, arguments: toolArguments } }],
      },
      done: true,
      done_reason: 'stop',
      prompt_eval_count: 17,
      eval_count: 6,
    })}\n`, { headers: { 'content-type': 'application/x-ndjson' } });
  };
  const capability = createAiSdkInferenceCapability(
    resolvedRoute.capability_id,
    resolvedRoute.surface,
    {
      language_models: createAiSdkLanguageModelRegistry(fixtureFetch),
      diagnostic_sink: { publish: diagnostic => diagnostics.push(diagnostic) },
    },
  );
  const input = invocation(resolvedRoute);
  const events = await collect(capability.stream({
    ...input,
    request: {
      ...input.request,
      tools: [{
        name: 'read_file',
        description: '读取文件',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: '文件路径' } },
          required: ['path'],
          additionalProperties: false,
        },
      }],
      tool_choice: 'auto',
    },
  }));
  return { events, diagnostics, requestCount };
}

describe('Ollama Provider package codec conformance', () => {
  it('目录外工具保留原始调用交 Host admission，消费 SDK 错误副本并保留 usage/finish', async () => {
    const result = await projectOllamaToolCall('sensitive-unknown-tool', { path: 'sensitive-path' });

    expect(result.requestCount).toBe(1);
    expect(result.events.at(-1)).toEqual({ type: 'finish', reason: 'tool_use' });
    expect(result.events.some(event => event.type === 'failure')).toBe(false);
    expect(result.events.filter(event => event.type === 'tool_call_end')).toEqual([
      { type: 'tool_call_end', index: 0, call: {
        id: expect.any(String), name: 'sensitive-unknown-tool', arguments: { path: 'sensitive-path' },
      } },
    ]);
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'usage', usage: expect.objectContaining({ inputTokens: 17, outputTokens: 6 }),
    }));
    expect(JSON.stringify(result.diagnostics)).not.toMatch(/sensitive-unknown-tool|sensitive-path/u);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      type: 'attempt_observed', terminal_event_received: true, terminal_event_type: 'finish',
    }));
  });

  it.each([
    { toolName: 'read_file', input: 'sensitive-broken-arguments' },
    { toolName: 'read_file', input: ['sensitive-array-input'] },
    { toolName: 'unknown_tool', input: 'sensitive-broken-arguments' },
    { toolName: 'unknown_tool', input: ['sensitive-array-input'] },
  ])(
    '原生 codec 接纳的非 object 参数只请求一次并形成可重试输入错误：%j',
    async ({ toolName, input }) => {
      const result = await projectOllamaToolCall(toolName, input);

      expect(result.requestCount).toBe(1);
      expect(result.events.at(-1)).toEqual({
        type: 'failure', kind: 'protocol', code: 'provider_tool_arguments_invalid', retryable: true, retry_category: 'output',
      });
      expect(result.events.filter(event => event.type === 'failure')).toHaveLength(1);
      expect(result.events.some(event => event.type === 'tool_call_end')).toBe(false);
      expect(result.diagnostics).toContainEqual(expect.objectContaining({
        type: 'failure_projected', error_shape: 'tool_call_error', stream_part_type: 'tool-call',
        failure_code: 'provider_tool_arguments_invalid',
      }));
      expect(JSON.stringify(result.diagnostics)).not.toMatch(/sensitive-broken|sensitive-array/u);
    },
  );

  it('未知调用经 Host 拒绝结果回放后可提出已声明工具调用，不改名或追加 SDK 请求', async () => {
    const resolvedRoute = route({
      capabilityId: 'ai-sdk:ollama', surface: 'ollama_chat', authProfile: 'bearer',
      providerModelId: 'fixture-model',
    });
    const result = await runToolRoundTrip({
      resolvedRoute,
      responseEncoding: 'ndjson',
      firstResponse: [{
        model: 'fixture-model', created_at: '2026-09-04T00:00:00.000Z',
        message: {
          role: 'assistant', content: '',
          tool_calls: [{ function: { name: 'undeclared_tool', arguments: { path: '/tmp/a' } } }],
        },
        done: true, done_reason: 'stop', prompt_eval_count: 17, eval_count: 6,
      }],
      // codec harness 注入 Host 的拒绝 observation；真正的执行范围校验由 Host gate 验证。
      toolResultContent: [{ type: 'text', text: '工具未获授权；请使用本次提供的工具。' }],
      secondResponse: [{
        model: 'fixture-model', created_at: '2026-09-04T00:00:01.000Z',
        message: {
          role: 'assistant', content: '',
          tool_calls: [{ function: { name: 'read_file', arguments: { path: '/tmp/a' } } }],
        },
        done: true, done_reason: 'stop', prompt_eval_count: 24, eval_count: 3,
      }],
    });

    expect(result.requests).toHaveLength(2);
    expect(result.requests[1]?.body).toMatchObject({
      messages: [
        { role: 'user' },
        { role: 'assistant', tool_calls: [{
          function: { name: 'undeclared_tool', arguments: { path: '/tmp/a' } },
        }] },
        { role: 'tool', tool_name: 'undeclared_tool', content: '工具未获授权；请使用本次提供的工具。' },
      ],
    });
    expect(result.secondEvents).toContainEqual(expect.objectContaining({
      type: 'tool_call_end', call: expect.objectContaining({ name: 'read_file' }),
    }));
    expect(result.secondEvents.at(-1)).toEqual({ type: 'finish', reason: 'tool_use' });
    expect([...result.firstEvents, ...result.secondEvents].some(event => event.type === 'failure')).toBe(false);
  });

  it('合法 object 的缺 required 字段仍交工具 owner admission，不在 adapter 重复校验', async () => {
    const result = await projectOllamaToolCall('read_file', {});

    expect(result.requestCount).toBe(1);
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'tool_call_end', call: expect.objectContaining({ name: 'read_file', arguments: {} }),
    }));
    expect(result.events.at(-1)).toEqual({ type: 'finish', reason: 'tool_use' });
    expect(result.events.some(event => event.type === 'failure')).toBe(false);
  });

  it('用原生 Chat codec 完成 reasoning、工具调用、usage 与第二轮回放', async () => {
    const resolvedRoute = route({
      capabilityId: 'ai-sdk:ollama',
      surface: 'ollama_chat',
      authProfile: 'bearer',
      providerModelId: 'glm-5.3',
      endpointId: 'ollama-cloud',
      baseUrl: 'https://ollama.com',
    });
    const result = await runToolRoundTrip({
      resolvedRoute,
      responseEncoding: 'ndjson',
      firstResponse: [
        {
          model: 'glm-5.3',
          created_at: '2026-09-04T00:00:00.000Z',
          message: { role: 'assistant', thinking: '先读取文件。', content: '' },
          done: false,
        },
        {
          model: 'glm-5.3',
          created_at: '2026-09-04T00:00:01.000Z',
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ function: { name: 'read_file', arguments: { path: '/tmp/a' } } }],
          },
          done: false,
        },
        {
          model: 'glm-5.3',
          created_at: '2026-09-04T00:00:02.000Z',
          message: { role: 'assistant', content: '' },
          done: true,
          done_reason: 'stop',
          prompt_eval_count: 17,
          eval_count: 6,
        },
      ],
      secondResponse: [
        {
          model: 'glm-5.3',
          created_at: '2026-09-04T00:00:03.000Z',
          message: { role: 'assistant', content: '读取完成。' },
          done: false,
        },
        {
          model: 'glm-5.3',
          created_at: '2026-09-04T00:00:04.000Z',
          message: { role: 'assistant', content: '' },
          done: true,
          done_reason: 'stop',
          prompt_eval_count: 24,
          eval_count: 3,
        },
      ],
      toolResultContent: [
        { type: 'text', text: 'file contents' },
        { type: 'image', media_type: 'image/png', bytes: new Uint8Array([1, 2, 3]) },
      ],
    });

    expect(result.requests).toHaveLength(2);
    expect(result.requests[0]?.url).toBe('https://ollama.com/api/chat');
    expect(result.requests[0]?.headers.get('authorization')).toBe('Bearer fixture-secret');
    expect(result.requests[0]?.body).toMatchObject({
      model: 'glm-5.3',
      stream: true,
      think: 'high',
      options: { num_predict: 128 },
      tools: [{ type: 'function', function: { name: 'read_file' } }],
    });
    expect(result.firstEvents).toEqual(
      expect.arrayContaining([
        { type: 'thought_delta', text: '先读取文件。' },
        {
          type: 'tool_call_end',
          index: 0,
          call: expect.objectContaining({
            id: expect.any(String),
            name: 'read_file',
            arguments: { path: '/tmp/a' },
          }),
        },
        {
          type: 'usage',
          usage: expect.objectContaining({
            inputTokens: 17,
            outputTokens: 6,
            source: 'provider-response-usage',
            confidence: 'actual',
          }),
        },
        { type: 'finish', reason: 'tool_use' },
      ])
    );
    expect(result.requests[1]?.body).toMatchObject({
      messages: [
        { role: 'user', content: '读取文件' },
        {
          role: 'assistant',
          content: '先读取文件。',
          tool_calls: [
            {
              type: 'function',
              function: { name: 'read_file', arguments: { path: '/tmp/a' } },
            },
          ],
        },
        {
          role: 'tool',
          content: 'file contents',
          tool_name: 'read_file',
          images: ['AQID'],
        },
      ],
    });
    expect(result.secondEvents[result.secondEvents.length - 1]).toEqual({
      type: 'finish',
      reason: 'stop',
    });
  });
});
