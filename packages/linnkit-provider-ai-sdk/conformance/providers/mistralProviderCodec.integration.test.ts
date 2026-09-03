import { describe, expect, it } from 'vitest';

import { route, runToolRoundTrip } from '../fixtures/dedicatedProviderCodecFixture';

describe('dedicated Provider package codec conformance', () => {
  it('Mistral 由官方 codec 完成 reasoning、工具调用、usage 与第二轮回放', async () => {
    const resolvedRoute = route({
      capabilityId: 'ai-sdk:mistral',
      surface: 'openai_chat_completions',
      authProfile: 'bearer',
      providerModelId: 'mistral-small-latest',
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
              index: 0,
              delta: {
                role: 'assistant',
                content: [
                  {
                    type: 'thinking',
                    thinking: [{ type: 'text', text: '先读取文件。' }],
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
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    id: 'call-1',
                    function: { name: 'read_file', arguments: '{"path":"/tmp/a"}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 17, completion_tokens: 6, total_tokens: 23 },
        },
      ],
      secondResponse: [
        {
          id: 'response-2',
          created: 2,
          model: resolvedRoute.endpoint_model_id,
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: '读取完成。' },
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
      model: 'mistral-small-latest',
      stream: true,
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
            source: 'provider-response-usage',
            confidence: 'actual',
          }),
        },
        { type: 'finish', reason: 'tool_use' },
      ])
    );
    expect(result.requests[1]?.body).toMatchObject({
      messages: [
        { role: 'user', content: [{ type: 'text', text: '读取文件' }] },
        {
          role: 'assistant',
          content: [
            {
              type: 'thinking',
              thinking: [{ type: 'text', text: '先读取文件。' }],
              closed: true,
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
        {
          role: 'tool',
          name: 'read_file',
          tool_call_id: 'call-1',
          content: 'file contents',
        },
      ],
    });
    expect(result.secondEvents[result.secondEvents.length - 1]).toEqual({
      type: 'finish',
      reason: 'stop',
    });
  });
});
