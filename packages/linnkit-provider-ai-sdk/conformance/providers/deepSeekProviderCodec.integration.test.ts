import { describe, expect, it } from 'vitest';

import { route, runToolRoundTrip } from '../fixtures/dedicatedProviderCodecFixture';

describe('dedicated Provider package codec conformance', () => {
  it('DeepSeek V4 由官方 codec 完成 reasoning、工具调用、usage 与第二轮回放', async () => {
    const resolvedRoute = route({
      capabilityId: 'ai-sdk:deepseek',
      surface: 'openai_chat_completions',
      authProfile: 'bearer',
      providerModelId: 'deepseek-v4-pro',
    });
    const result = await runToolRoundTrip({
      resolvedRoute,
      firstResponse: [
        {
          id: 'response-1',
          created: 1,
          model: resolvedRoute.endpoint_model_id,
          choices: [
            {
              delta: { role: 'assistant', reasoning_content: '先读取文件。' },
              finish_reason: null,
            },
          ],
        },
        {
          id: 'response-1',
          created: 1,
          model: resolvedRoute.endpoint_model_id,
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call-1',
                    function: { name: 'read_file', arguments: '{"path":"/tmp/a"}' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        {
          id: 'response-1',
          created: 1,
          model: resolvedRoute.endpoint_model_id,
          choices: [{ delta: {}, finish_reason: 'tool_calls' }],
          usage: {
            prompt_tokens: 17,
            completion_tokens: 6,
            prompt_cache_hit_tokens: 4,
            prompt_cache_miss_tokens: 13,
            total_tokens: 23,
            completion_tokens_details: { reasoning_tokens: 2 },
          },
        },
      ],
      secondResponse: [
        {
          id: 'response-2',
          created: 2,
          model: resolvedRoute.endpoint_model_id,
          choices: [{ delta: { role: 'assistant', content: '读取完成。' }, finish_reason: null }],
        },
        {
          id: 'response-2',
          created: 2,
          model: resolvedRoute.endpoint_model_id,
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 24, completion_tokens: 3, total_tokens: 27 },
        },
      ],
    });

    expect(result.requests).toHaveLength(2);
    expect(result.requests[0]?.url).toBe('https://fixture.invalid/v1/chat/completions');
    expect(result.requests[0]?.headers.get('authorization')).toBe('Bearer fixture-secret');
    expect(result.requests[0]?.body).toMatchObject({
      model: 'deepseek-v4-pro',
      stream: true,
      tools: [{ type: 'function', function: { name: 'read_file' } }],
    });
    expect(result.requests[0]?.body).toHaveProperty('tool_choice', 'auto');
    expect(result.firstEvents).toEqual(
      expect.arrayContaining([
        { type: 'thought_delta', text: '先读取文件。' },
        {
          type: 'assistant_part_end',
          index: 0,
          part: { type: 'reasoning', text: '先读取文件。' },
        },
        {
          type: 'tool_call_end',
          index: 0,
          call: { id: 'call-1', name: 'read_file', arguments: { path: '/tmp/a' } },
        },
        {
          type: 'usage',
          usage: {
            inputTokens: 13,
            outputTokens: 6,
            cacheReadTokens: 4,
            reasoningTokens: 2,
            source: 'provider-response-usage',
            confidence: 'actual',
            rawUsage: {
              prompt_tokens: 17,
              completion_tokens: 6,
              prompt_cache_hit_tokens: 4,
              prompt_cache_miss_tokens: 13,
              total_tokens: 23,
              completion_tokens_details: { reasoning_tokens: 2 },
            },
          },
        },
        { type: 'finish', reason: 'tool_use' },
      ])
    );
    expect(result.requests[1]?.body).toMatchObject({
      messages: [
        { role: 'user', content: '读取文件' },
        {
          role: 'assistant',
          content: '',
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
    expect(result.requests[1]?.body).toHaveProperty('tool_choice', 'auto');
    expect(result.secondEvents[result.secondEvents.length - 1]).toEqual({
      type: 'finish',
      reason: 'stop',
    });
  });
});
