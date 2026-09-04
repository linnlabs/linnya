import { describe, expect, it } from 'vitest';

import { route, runToolRoundTrip } from '../fixtures/dedicatedProviderCodecFixture';

describe('Ollama Provider package codec conformance', () => {
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
        { role: 'tool', content: 'file contents', tool_name: 'read_file' },
      ],
    });
    expect(result.secondEvents[result.secondEvents.length - 1]).toEqual({
      type: 'finish',
      reason: 'stop',
    });
  });
});
