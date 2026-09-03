import { describe, expect, it } from 'vitest';

import { route, runToolRoundTrip } from '../fixtures/dedicatedProviderCodecFixture';

const COMPATIBLE_PROVIDERS = [
  {
    id: 'siliconflow',
    baseUrl: 'https://api.siliconflow.com/v1',
    modelId: 'zai-org/GLM-5.2',
  },
  {
    id: 'siliconflow-cn',
    baseUrl: 'https://api.siliconflow.cn/v1',
    modelId: 'zai-org/GLM-5.2',
  },
  {
    id: 'nvidia',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    modelId: 'nvidia/llama-3.3-nemotron-super-49b-v1',
  },
  {
    id: 'modelscope',
    baseUrl: 'https://api-inference.modelscope.cn/v1',
    modelId: 'ZhipuAI/GLM-4.6',
  },
] as const;

describe('OpenAI-compatible formal Provider codec conformance', () => {
  it.each(COMPATIBLE_PROVIDERS)(
    '$id 共享第三方 codec 完成 reasoning、工具、usage 与两轮回放',
    async provider => {
      const resolvedRoute = route({
        capabilityId: 'ai-sdk:openai-compatible',
        surface: 'openai_chat_completions',
        authProfile: 'bearer',
        endpointId: provider.id,
        baseUrl: provider.baseUrl,
        providerModelId: provider.modelId,
      });
      const result = await runToolRoundTrip({
        resolvedRoute,
        firstResponse: [
          {
            id: 'response-1',
            created: 1,
            model: provider.modelId,
            choices: [
              {
                index: 0,
                delta: { reasoning_content: '先读取文件。' },
                finish_reason: null,
              },
            ],
          },
          {
            id: 'response-1',
            created: 1,
            model: provider.modelId,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call-1',
                      type: 'function',
                      function: { name: 'read_file', arguments: '{"path":"/tmp/a"}' },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
            usage: {
              prompt_tokens: 17,
              completion_tokens: 6,
              total_tokens: 23,
              completion_tokens_details: { reasoning_tokens: 2 },
            },
          },
        ],
        secondResponse: [
          {
            id: 'response-2',
            created: 2,
            model: provider.modelId,
            choices: [
              {
                index: 0,
                delta: { content: '读取完成。' },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 24, completion_tokens: 3, total_tokens: 27 },
          },
        ],
      });

      expect(result.requests).toHaveLength(2);
      expect(result.requests[0]?.url).toBe(`${provider.baseUrl}/chat/completions`);
      expect(result.requests[0]?.headers.get('authorization')).toBe('Bearer fixture-secret');
      expect(result.requests[0]?.body).toMatchObject({
        model: provider.modelId,
        stream: true,
        stream_options: { include_usage: true },
        tools: [{ type: 'function', function: { name: 'read_file' } }],
      });
      expect(result.firstEvents).toEqual(
        expect.arrayContaining([
          { type: 'thought_delta', text: '先读取文件。' },
          {
            type: 'tool_call_end',
            index: 0,
            call: { id: 'call-1', name: 'read_file', arguments: { path: '/tmp/a' } },
          },
          {
            type: 'usage',
            usage: expect.objectContaining({
              inputTokens: 17,
              outputTokens: 6,
              reasoningTokens: 2,
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
            reasoning_content: '先读取文件。',
            tool_calls: [
              {
                type: 'function',
                id: 'call-1',
                function: { name: 'read_file', arguments: '{"path":"/tmp/a"}' },
              },
            ],
          },
          { role: 'tool', tool_call_id: 'call-1', content: 'file contents' },
        ],
      });
      expect(result.secondEvents[result.secondEvents.length - 1]).toEqual({
        type: 'finish',
        reason: 'stop',
      });
    }
  );
});
