import type { CanonicalInferenceEvent, CanonicalInferenceRequest } from '@linnlabs/linnkit/ports';
import type { ProviderContinuation } from '@linnlabs/linnkit/contracts';
import { describe, expect, it } from 'vitest';
import {
  createAiSdkInferenceCapability,
  createAiSdkLanguageModelRegistry,
  type AiSdkInferenceCapabilityInvocation,
  type AiSdkInferenceRoute,
} from '@linnlabs/linnkit-provider-ai-sdk';

const route = {
  model_id: 'model-1',
  request_profile: 'openai_chat',
  capability_id: 'ai-sdk:openai-chat',
  endpoint_id: 'fixture-openai',
  endpoint_model_id: 'gpt-fixture',
  surface: 'openai_chat_completions',
  base_url: 'https://fixture.invalid/v1',
  headers: { 'x-device-id': 'device-fixture' },
} satisfies AiSdkInferenceRoute;

function request(): CanonicalInferenceRequest {
  return {
    model_id: route.model_id,
    messages: [{ role: 'user', content: [{ type: 'text', text: '读取文件' }] }],
    tools: [{
      name: 'read_file',
      description: 'Read one file',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Path' } },
        required: ['path'],
        additionalProperties: false,
      },
    }],
    tool_choice: 'auto',
    sampling: { temperature: 0, max_output_tokens: 256 },
    invocation: { trace_id: 'trace-1', attempt_id: 'attempt-1' },
  };
}

function invocation(): AiSdkInferenceCapabilityInvocation {
  return {
    request: request(),
    route,
    credential: { profile: 'bearer', secret: 'fixture-secret' },
  };
}

async function collect(stream: AsyncIterable<CanonicalInferenceEvent>) {
  const events: CanonicalInferenceEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function eventStream(lines: readonly string[]): Response {
  return new Response(`${lines.map(line => `data: ${line}\n\n`).join('')}data: [DONE]\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('OpenAI Chat AI SDK capability integration', () => {
  it('把已物化图片交给官方 codec，Provider body 不携带 Workspace 身份', async () => {
    let requestBody: unknown;
    const fixtureFetch: typeof fetch = async (_input, init) => {
      if (typeof init?.body === 'string') requestBody = JSON.parse(init.body);
      return eventStream([
        JSON.stringify({
          id: 'chatcmpl-image',
          object: 'chat.completion.chunk',
          created: 1,
          model: route.endpoint_model_id,
          choices: [{
            index: 0,
            delta: { role: 'assistant', content: 'image received' },
            finish_reason: null,
          }],
        }),
        JSON.stringify({
          id: 'chatcmpl-image',
          object: 'chat.completion.chunk',
          created: 1,
          model: route.endpoint_model_id,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        }),
      ]);
    };
    const capability = createAiSdkInferenceCapability(
      route.capability_id,
      route.surface,
      { language_models: createAiSdkLanguageModelRegistry(fixtureFetch) }
    );
    const imageBytes = Uint8Array.from([1, 2, 3, 4]);
    const imageRequest: CanonicalInferenceRequest = {
      model_id: route.model_id,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'describe' },
          { type: 'image', media_type: 'image/png', bytes: imageBytes },
        ],
      }],
      tools: [],
      tool_choice: 'none',
      sampling: { max_output_tokens: 64 },
      invocation: { trace_id: 'trace-image', attempt_id: 'attempt-image' },
    };

    await collect(capability.stream({
      request: imageRequest,
      route,
      credential: { profile: 'bearer', secret: 'fixture-secret' },
    }));

    expect(requestBody).toMatchObject({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'describe' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AQIDBA==' } },
        ],
      }],
    });
    expect(JSON.stringify(requestBody)).not.toMatch(
      /attachment|resourceId|sha256|fileName|workspace/u
    );
  });

  it('OpenAI-compatible profile 支持无认证的 Ollama /v1，并且不注入 Authorization', async () => {
    const compatibleRoute = {
      ...route,
      model_id: 'ollama-qwen3',
      capability_id: 'ai-sdk:openai-compatible',
      endpoint_id: 'ollama',
      endpoint_model_id: 'qwen3',
      base_url: 'http://127.0.0.1:11434/v1',
      headers: undefined,
    } satisfies AiSdkInferenceRoute;
    let requestUrl = '';
    let authorization: string | null = 'not-read';
    const fixtureFetch: typeof fetch = async (input, init) => {
      requestUrl = String(input);
      authorization = new Headers(init?.headers).get('authorization');
      return eventStream([
        JSON.stringify({
          id: 'chatcmpl-compatible',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'qwen3',
          choices: [{ index: 0, delta: { role: 'assistant', content: 'local answer' }, finish_reason: null }],
        }),
        JSON.stringify({
          id: 'chatcmpl-compatible',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'qwen3',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
        }),
      ]);
    };
    const capability = createAiSdkInferenceCapability(
      compatibleRoute.capability_id,
      compatibleRoute.surface,
      { language_models: createAiSdkLanguageModelRegistry(fixtureFetch) }
    );
    const compatibleRequest: CanonicalInferenceRequest = {
      model_id: compatibleRoute.model_id,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      tools: [],
      tool_choice: 'none',
      sampling: { max_output_tokens: 64 },
      invocation: { trace_id: 'trace-compatible', attempt_id: 'attempt-compatible' },
    };

    const events = await collect(
      capability.stream({ request: compatibleRequest, route: compatibleRoute })
    );

    expect(requestUrl).toBe('http://127.0.0.1:11434/v1/chat/completions');
    expect(authorization).toBeNull();
    expect(events).toEqual([
      { type: 'start', model_id: 'ollama-qwen3', attempt_id: 'attempt-compatible' },
      { type: 'answer_delta', text: 'local answer' },
      {
        type: 'assistant_part_end',
        index: 0,
        part: { type: 'text', text: 'local answer' },
      },
      {
        type: 'usage',
        usage: {
          inputTokens: 4,
          outputTokens: 2,
          cacheReadTokens: 0,
          reasoningTokens: 0,
          source: 'provider-response-usage',
          confidence: 'actual',
          rawUsage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
        },
      },
      { type: 'finish', reason: 'stop' },
    ]);
  });

  it('从 Responses 模型切到 OpenAI-compatible Chat 时只发送 canonical 历史', async () => {
    const compatibleRoute = {
      ...route,
      model_id: 'glm-model',
      request_profile: 'openai_compatible_chat',
      capability_id: 'ai-sdk:openai-compatible',
      endpoint_id: 'opencode-go',
      endpoint_model_id: 'glm-5.3-flash',
    } satisfies AiSdkInferenceRoute;
    const producer = {
      model_id: 'gpt-model',
      endpoint_id: 'chatgpt-subscription',
      api_surface: 'openai_responses',
      capability_id: 'ai-sdk:openai-responses',
      endpoint_model_id: 'gpt-5.6-sol',
    } as const;
    const reasoningContinuation: ProviderContinuation = {
      schema_version: 2,
      producer,
      kind: 'ai-sdk:openai-responses-part',
      payload: {
        target: 'reasoning',
        item_id: 'reasoning-item-private',
        reasoning_encrypted_content: 'encrypted-private',
      },
    };
    const toolContinuation: ProviderContinuation = {
      schema_version: 2,
      producer,
      kind: 'ai-sdk:openai-responses-part',
      payload: {
        target: 'tool_call',
        tool_call_id: 'call-1',
        item_id: 'tool-item-private',
      },
    };
    let requestBody: unknown;
    const fixtureFetch: typeof fetch = async (_input, init) => {
      if (typeof init?.body === 'string') requestBody = JSON.parse(init.body);
      return eventStream([
        JSON.stringify({
          id: 'chatcmpl-switched',
          object: 'chat.completion.chunk',
          created: 1,
          model: compatibleRoute.endpoint_model_id,
          choices: [{
            index: 0,
            delta: { role: 'assistant', content: 'continued' },
            finish_reason: null,
          }],
        }),
        JSON.stringify({
          id: 'chatcmpl-switched',
          object: 'chat.completion.chunk',
          created: 1,
          model: compatibleRoute.endpoint_model_id,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        }),
      ]);
    };
    const capability = createAiSdkInferenceCapability(
      compatibleRoute.capability_id,
      compatibleRoute.surface,
      { language_models: createAiSdkLanguageModelRegistry(fixtureFetch) },
    );
    const switchedRequest: CanonicalInferenceRequest = {
      model_id: compatibleRoute.model_id,
      messages: [
        {
          role: 'assistant',
          parts: [
            {
              type: 'reasoning',
              text: '先读取资料。',
              continuation: [reasoningContinuation],
            },
            { type: 'text', text: '准备读取。' },
            {
              type: 'tool_call',
              call: {
                id: 'call-1',
                name: 'read_file',
                arguments: { path: '/tmp/a' },
                continuation: [toolContinuation],
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call-1',
          content: [{ type: 'text', text: 'file contents' }],
        },
        { role: 'user', content: [{ type: 'text', text: '继续' }] },
      ],
      tools: [],
      tool_choice: 'none',
      sampling: { max_output_tokens: 64 },
      invocation: { trace_id: 'trace-switched', attempt_id: 'attempt-switched' },
    };

    await collect(capability.stream({
      request: switchedRequest,
      route: compatibleRoute,
      credential: { profile: 'bearer', secret: 'fixture-secret' },
    }));

    expect(requestBody).toMatchObject({
      model: 'glm-5.3-flash',
      messages: [
        {
          role: 'assistant',
          reasoning_content: '先读取资料。',
          content: '准备读取。',
          tool_calls: [{
            id: 'call-1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"/tmp/a"}' },
          }],
        },
        { role: 'tool', tool_call_id: 'call-1', content: 'file contents' },
        { role: 'user', content: '继续' },
      ],
    });
    expect(JSON.stringify(requestBody)).not.toMatch(
      /reasoning-item-private|tool-item-private|encrypted-private|chatgpt-subscription/u,
    );
  });

  it('把 SSE 结构化上游错误投影为可观察、可重试且脱敏的 failure', async () => {
    const compatibleRoute = {
      ...route,
      capability_id: 'ai-sdk:openai-compatible',
      endpoint_id: 'openai-compatible:company',
    } satisfies AiSdkInferenceRoute;
    const fixtureFetch: typeof fetch = async () => eventStream([
      JSON.stringify({
        error: {
          type: 'server_error',
          code: 'upstream_error',
          message: 'sensitive gateway diagnostics',
        },
      }),
    ]);
    const capability = createAiSdkInferenceCapability(
      compatibleRoute.capability_id,
      compatibleRoute.surface,
      { language_models: createAiSdkLanguageModelRegistry(fixtureFetch) }
    );

    const events = await collect(capability.stream({
      request: request(),
      route: compatibleRoute,
      credential: { profile: 'bearer', secret: 'fixture-secret' },
    }));

    expect(events).toEqual([
      { type: 'start', model_id: 'model-1', attempt_id: 'attempt-1' },
      {
        type: 'failure',
        kind: 'provider',
        code: 'provider_stream_unavailable',
        retryable: true,
      },
    ]);
    expect(JSON.stringify(events)).not.toContain('sensitive gateway diagnostics');
  });

  it('system message 与空工具 auto 能完整进入 Provider 请求', async () => {
    let fetchCount = 0;
    let requestBody: unknown;
    const fixtureFetch: typeof fetch = async (_input, init) => {
      fetchCount += 1;
      if (typeof init?.body === 'string') {
        requestBody = JSON.parse(init.body);
      }
      return eventStream([
        JSON.stringify({
          id: 'chatcmpl-no-tools', object: 'chat.completion.chunk', created: 1, model: 'gpt-fixture',
          choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }],
        }),
        JSON.stringify({
          id: 'chatcmpl-no-tools', object: 'chat.completion.chunk', created: 1, model: 'gpt-fixture',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        }),
      ]);
    };
    const capability = createAiSdkInferenceCapability(
      route.capability_id,
      route.surface,
      { language_models: createAiSdkLanguageModelRegistry(fixtureFetch) }
    );
    const noToolsRequest: CanonicalInferenceRequest = {
      ...request(),
      messages: [
        { role: 'system', content: '只做简短回答' },
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      ],
      tools: [],
      tool_choice: 'auto',
      invocation: { trace_id: 'trace-no-tools', attempt_id: 'attempt-no-tools' },
    };

    const events = await collect(capability.stream({
      request: noToolsRequest,
      route,
      credential: { profile: 'bearer', secret: 'fixture-secret' },
    }));

    expect(fetchCount).toBe(1);
    expect(requestBody).not.toHaveProperty('tools');
    expect(requestBody).not.toHaveProperty('tool_choice');
    expect(requestBody).toMatchObject({
      messages: [
        { role: 'system', content: '只做简短回答' },
        { role: 'user' },
      ],
    });
    expect(events[events.length - 1]).toEqual({ type: 'finish', reason: 'stop' });
  });

  it('通过真实 AI SDK Provider codec 投影工具流、raw usage，并且工具不会在 Host 执行', async () => {
    let fetchCount = 0;
    let requestBody: unknown;
    let authorization: string | null = null;
    let deviceId: string | null = null;
    const fixtureFetch: typeof fetch = async (_input, init) => {
      fetchCount += 1;
      authorization = new Headers(init?.headers).get('authorization');
      deviceId = new Headers(init?.headers).get('x-device-id');
      if (typeof init?.body === 'string') requestBody = JSON.parse(init.body);
      return eventStream([
        JSON.stringify({
          id: 'chatcmpl-1', object: 'chat.completion.chunk', created: 1, model: 'gpt-fixture',
          choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
        }),
        JSON.stringify({
          id: 'chatcmpl-1', object: 'chat.completion.chunk', created: 1, model: 'gpt-fixture',
          choices: [{
            index: 0,
            delta: { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'read_file', arguments: '{"path"' } }] },
            finish_reason: null,
          }],
        }),
        JSON.stringify({
          id: 'chatcmpl-1', object: 'chat.completion.chunk', created: 1, model: 'gpt-fixture',
          choices: [{
            index: 0,
            delta: { tool_calls: [{ index: 0, function: { arguments: ':"/tmp/a"}' } }] },
            finish_reason: null,
          }],
        }),
        JSON.stringify({
          id: 'chatcmpl-1', object: 'chat.completion.chunk', created: 1, model: 'gpt-fixture',
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
          usage: {
            prompt_tokens: 20,
            completion_tokens: 5,
            total_tokens: 25,
            prompt_tokens_details: { cached_tokens: 4 },
          },
        }),
      ]);
    };
    const capability = createAiSdkInferenceCapability(
      route.capability_id,
      route.surface,
      { language_models: createAiSdkLanguageModelRegistry(fixtureFetch) }
    );

    const events = await collect(capability.stream(invocation()));

    expect(fetchCount).toBe(1);
    expect(authorization).toBe('Bearer fixture-secret');
    expect(deviceId).toBe('device-fixture');
    expect(requestBody).toMatchObject({
      model: 'gpt-fixture',
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0,
      max_tokens: 256,
      tool_choice: 'auto',
      tools: [{
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read one file',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string', description: 'Path' } },
            required: ['path'],
            additionalProperties: false,
          },
        },
      }],
    });
    expect(events).toEqual([
      { type: 'start', model_id: 'model-1', attempt_id: 'attempt-1' },
      { type: 'tool_call_start', index: 0, part_index: 0, id: 'call-1', name: 'read_file' },
      { type: 'tool_argument_delta', index: 0, json_delta: '{"path"' },
      { type: 'tool_argument_delta', index: 0, json_delta: ':"/tmp/a"}' },
      {
        type: 'tool_call_end',
        index: 0,
        call: { id: 'call-1', name: 'read_file', arguments: { path: '/tmp/a' } },
      },
      {
        type: 'usage',
        usage: {
          inputTokens: 16,
          outputTokens: 5,
          cacheReadTokens: 4,
          reasoningTokens: 0,
          source: 'provider-response-usage',
          confidence: 'actual',
          rawUsage: {
            prompt_tokens: 20,
            completion_tokens: 5,
            total_tokens: 25,
            prompt_tokens_details: { cached_tokens: 4 },
          },
        },
      },
      { type: 'finish', reason: 'tool_use' },
    ]);
  });

  it('Provider 503 时 AI SDK maxRetries=0，单个 attempt 只发一次 fetch', async () => {
    let fetchCount = 0;
    const fixtureFetch: typeof fetch = async () => {
      fetchCount += 1;
      return new Response(JSON.stringify({ error: { message: 'fixture failure' } }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    };
    const capability = createAiSdkInferenceCapability(
      route.capability_id,
      route.surface,
      { language_models: createAiSdkLanguageModelRegistry(fixtureFetch) }
    );

    const events = await collect(capability.stream(invocation()));

    expect(fetchCount).toBe(1);
    expect(events).toEqual([
      { type: 'start', model_id: 'model-1', attempt_id: 'attempt-1' },
      { type: 'failure', kind: 'provider', code: 'provider_http_503', retryable: true },
    ]);
  });

});
