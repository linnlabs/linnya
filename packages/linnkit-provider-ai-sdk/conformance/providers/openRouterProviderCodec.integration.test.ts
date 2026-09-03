import { describe, expect, it } from 'vitest';

import { route, runToolRoundTrip } from '../fixtures/dedicatedProviderCodecFixture';

describe('OpenRouter Provider package codec conformance', () => {
  it('由官方 codec 完成 reasoning_details、工具调用、usage 与第二轮回放', async () => {
    const resolvedRoute = route({
      capabilityId: 'ai-sdk:openrouter',
      surface: 'openai_chat_completions',
      authProfile: 'bearer',
      providerModelId: 'anthropic/claude-sonnet-4.6',
    });
    const reasoningDetail = {
      type: 'reasoning.text',
      text: '先读取文件。',
      signature: 'fixture-signature',
      format: 'anthropic-claude-v1',
      sensitive_should_drop: 'not-durable',
    };
    const result = await runToolRoundTrip({
      resolvedRoute,
      firstResponse: [
        {
          id: 'response-1',
          model: resolvedRoute.endpoint_model_id,
          choices: [
            {
              index: 0,
              delta: { reasoning_details: [reasoningDetail] },
              finish_reason: null,
            },
          ],
        },
        {
          id: 'response-1',
          model: resolvedRoute.endpoint_model_id,
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
          model: resolvedRoute.endpoint_model_id,
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
    expect(result.requests[0]?.url).toBe('https://fixture.invalid/v1/chat/completions');
    expect(result.requests[0]?.headers.get('authorization')).toBe('Bearer fixture-secret');
    expect(result.requests[0]?.body).toMatchObject({
      model: 'anthropic/claude-sonnet-4.6',
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
          call: expect.objectContaining({
            id: 'call-1',
            name: 'read_file',
            arguments: { path: '/tmp/a' },
          }),
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
          content: null,
          reasoning: '先读取文件。',
          reasoning_details: [
            {
              type: 'reasoning.text',
              text: '先读取文件。',
              signature: 'fixture-signature',
              format: 'anthropic-claude-v1',
            },
          ],
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
    expect(JSON.stringify(result.replay)).not.toContain('sensitive_should_drop');
    expect(result.secondEvents[result.secondEvents.length - 1]).toEqual({
      type: 'finish',
      reason: 'stop',
    });
  });
});
