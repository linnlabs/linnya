import { describe, expect, it } from 'vitest';

import { route, runToolRoundTrip } from '../fixtures/dedicatedProviderCodecFixture';

describe('Cohere Provider package codec conformance', () => {
  it('由官方 V2 codec 完成 thinking、工具调用、usage 与第二轮回放', async () => {
    const resolvedRoute = route({
      capabilityId: 'ai-sdk:cohere',
      surface: 'cohere_chat',
      authProfile: 'bearer',
      providerModelId: 'command-a-reasoning-08-2025',
      endpointId: 'cohere',
      baseUrl: 'https://api.cohere.com/v2',
    });
    const result = await runToolRoundTrip({
      resolvedRoute,
      firstResponse: [
        { type: 'message-start', id: 'response-1' },
        {
          type: 'content-start',
          index: 0,
          delta: { message: { content: { type: 'thinking', thinking: '' } } },
        },
        {
          type: 'content-delta',
          index: 0,
          delta: { message: { content: { thinking: '先读取文件。' } } },
        },
        { type: 'content-end', index: 0 },
        {
          type: 'tool-call-start',
          delta: {
            message: {
              tool_calls: {
                id: 'call-1',
                type: 'function',
                function: { name: 'read_file', arguments: '' },
              },
            },
          },
        },
        {
          type: 'tool-call-delta',
          delta: {
            message: { tool_calls: { function: { arguments: '{"path":"/tmp/a"}' } } },
          },
        },
        { type: 'tool-call-end' },
        {
          type: 'message-end',
          delta: {
            finish_reason: 'TOOL_CALL',
            usage: { tokens: { input_tokens: 17, output_tokens: 6 } },
          },
        },
      ],
      secondResponse: [
        { type: 'message-start', id: 'response-2' },
        {
          type: 'content-start',
          index: 0,
          delta: { message: { content: { type: 'text', text: '' } } },
        },
        {
          type: 'content-delta',
          index: 0,
          delta: { message: { content: { text: '读取完成。' } } },
        },
        { type: 'content-end', index: 0 },
        {
          type: 'message-end',
          delta: {
            finish_reason: 'COMPLETE',
            usage: { tokens: { input_tokens: 24, output_tokens: 3 } },
          },
        },
      ],
    });

    expect(result.requests).toHaveLength(2);
    expect(result.requests[0]?.url).toBe('https://api.cohere.com/v2/chat');
    expect(result.requests[0]?.headers.get('authorization')).toBe('Bearer fixture-secret');
    expect(result.requests[0]?.body).toMatchObject({
      model: 'command-a-reasoning-08-2025',
      stream: true,
      thinking: { type: 'enabled' },
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
        { role: 'user', content: '读取文件' },
        {
          role: 'assistant',
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
  });
});
