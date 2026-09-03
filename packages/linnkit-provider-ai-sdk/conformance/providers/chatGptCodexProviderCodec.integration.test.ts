import type { CanonicalInferenceEvent, CanonicalInferenceRequest } from '@linnlabs/linnkit/ports';
import { describe, expect, it } from 'vitest';
import {
  createAiSdkInferenceCapability,
  createAiSdkLanguageModelRegistry,
  type AiSdkInferenceCapabilityInvocation,
  type AiSdkInferenceRoute,
} from '@linnlabs/linnkit-provider-ai-sdk';

const CHATGPT_CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';

function responseEventStream(lines: readonly object[]): Response {
  return new Response(
    `${lines.map(line => `data: ${JSON.stringify(line)}\n\n`).join('')}data: [DONE]\n\n`,
    {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }
  );
}

async function collect(stream: AsyncIterable<CanonicalInferenceEvent>) {
  const events: CanonicalInferenceEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('ChatGPT Codex Responses Provider codec conformance', () => {
  it('复用 @ai-sdk/openai 投影订阅端点、账号认证与工具续轮', async () => {
    const requests: Array<{
      readonly url: string;
      readonly headers: Headers;
      readonly body: Record<string, unknown>;
    }> = [];
    let round = 0;
    const fixtureFetch: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        headers: new Headers(init?.headers),
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : {},
      });
      round += 1;
      if (round === 1) {
        return responseEventStream([
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: {
              type: 'function_call',
              id: 'item-call-1',
              call_id: 'call-1',
              name: 'read_file',
              arguments: '',
              status: 'in_progress',
            },
          },
          {
            type: 'response.function_call_arguments.delta',
            item_id: 'item-call-1',
            output_index: 0,
            delta: '{"path":"/tmp/a.txt"}',
          },
          {
            type: 'response.output_item.done',
            output_index: 0,
            item: {
              type: 'function_call',
              id: 'item-call-1',
              call_id: 'call-1',
              name: 'read_file',
              arguments: '{"path":"/tmp/a.txt"}',
              status: 'completed',
            },
          },
          {
            type: 'response.completed',
            response: {
              incomplete_details: null,
              usage: {
                input_tokens: 10,
                input_tokens_details: { cached_tokens: 0 },
                output_tokens: 5,
                output_tokens_details: { reasoning_tokens: 0 },
              },
              reasoning: null,
              service_tier: null,
            },
          },
        ]);
      }
      return responseEventStream([
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: { type: 'message', id: 'message-2', phase: 'final_answer' },
        },
        {
          type: 'response.output_text.delta',
          item_id: 'message-2',
          output_index: 0,
          delta: '读取完成',
        },
        {
          type: 'response.output_item.done',
          output_index: 0,
          item: { type: 'message', id: 'message-2', phase: 'final_answer', content: [] },
        },
        {
          type: 'response.completed',
          response: {
            incomplete_details: null,
            usage: {
              input_tokens: 20,
              input_tokens_details: { cached_tokens: 8 },
              output_tokens: 3,
              output_tokens_details: { reasoning_tokens: 0 },
            },
            reasoning: null,
            service_tier: null,
          },
        },
      ]);
    };

    const route = {
      model_id: 'chatgpt:gpt-5.6-sol',
      request_profile: 'chatgpt_codex_responses',
      capability_id: 'ai-sdk:openai-responses',
      endpoint_id: 'chatgpt-subscription',
      endpoint_model_id: 'gpt-5.6-sol',
      surface: 'openai_responses',
      base_url: CHATGPT_CODEX_BASE_URL,
      headers: {
        'chatgpt-account-id': 'account-fixture',
        originator: 'test-host',
        'OpenAI-Beta': 'responses=experimental',
      },
    } satisfies AiSdkInferenceRoute;
    const capability = createAiSdkInferenceCapability(route.capability_id, route.surface, {
      language_models: createAiSdkLanguageModelRegistry(fixtureFetch),
    });
    const firstRequest: CanonicalInferenceRequest = {
      model_id: route.model_id,
      messages: [
        { role: 'system', content: '你是测试 Agent。' },
        { role: 'user', content: [{ type: 'text', text: '读取文件' }] },
      ],
      tools: [
        {
          name: 'read_file',
          description: '读取文件',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string', description: '文件路径' } },
            required: ['path'],
            additionalProperties: false,
          },
        },
      ],
      tool_choice: 'auto',
      sampling: { max_output_tokens: 128, reasoning_effort: 'medium' },
      invocation: { trace_id: 'trace-chatgpt-1', attempt_id: 'attempt-chatgpt-1' },
    };
    const firstEvents = await collect(
      capability.stream({
        route,
        credential: { profile: 'bearer', secret: 'oauth-access-token' },
        request: firstRequest,
      })
    );
    const toolCall = firstEvents.find(event => event.type === 'tool_call_end');
    if (!toolCall || toolCall.type !== 'tool_call_end') {
      throw new Error(`fixture 未产生工具调用: ${JSON.stringify(firstEvents)}`);
    }

    const secondInvocation: AiSdkInferenceCapabilityInvocation = {
      route,
      credential: { profile: 'bearer', secret: 'oauth-access-token' },
      request: {
        ...firstRequest,
        messages: [
          ...firstRequest.messages,
          { role: 'assistant', parts: [{ type: 'tool_call', call: toolCall.call }] },
          {
            role: 'tool',
            tool_call_id: toolCall.call.id,
            content: [{ type: 'text', text: '文件内容' }],
          },
        ],
        invocation: { trace_id: 'trace-chatgpt-2', attempt_id: 'attempt-chatgpt-2' },
      },
    };
    const secondEvents = await collect(capability.stream(secondInvocation));

    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.url).toBe('https://chatgpt.com/backend-api/codex/responses');
      expect(request.headers.get('authorization')).toBe('Bearer oauth-access-token');
      expect(request.headers.get('chatgpt-account-id')).toBe('account-fixture');
      expect(request.headers.get('originator')).toBe('test-host');
      expect(request.headers.get('openai-beta')).toBe('responses=experimental');
      expect(request.body).toMatchObject({
        model: 'gpt-5.6-sol',
        stream: true,
        store: false,
        instructions: '你是测试 Agent。',
        parallel_tool_calls: true,
        text: { verbosity: 'low' },
        reasoning: { effort: 'medium', summary: 'auto' },
        include: ['reasoning.encrypted_content'],
      });
      expect(request.body).not.toHaveProperty('max_output_tokens');
      expect(request.body.input).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ role: 'developer' })])
      );
      expect(request.body.tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'function',
            name: 'read_file',
          }),
        ])
      );
      const tools = request.body.tools;
      if (!Array.isArray(tools)) throw new Error('ChatGPT Codex 请求缺少工具数组');
      expect(tools[0]).not.toHaveProperty('strict');
    }
    expect(requests[1]?.body).toMatchObject({
      input: [
        { role: 'user' },
        { type: 'function_call', call_id: 'call-1' },
        { type: 'function_call_output', call_id: 'call-1', output: '文件内容' },
      ],
    });
    expect(secondEvents).toContainEqual({ type: 'answer_delta', text: '读取完成' });
  });
});
