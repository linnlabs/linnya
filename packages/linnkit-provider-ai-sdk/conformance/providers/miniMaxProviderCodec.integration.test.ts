import { describe, expect, it } from 'vitest';

import { route, runToolRoundTrip } from '../fixtures/dedicatedProviderCodecFixture';

describe('dedicated Provider package codec conformance', () => {
  it('MiniMax 由官方 Anthropic codec 使用 x-api-key 并回放 thinking signature 与工具结果', async () => {
    const resolvedRoute = route({
      capabilityId: 'ai-sdk:minimax',
      surface: 'anthropic_messages',
      authProfile: 'api_key',
      providerModelId: 'MiniMax-M2.7',
    });
    const result = await runToolRoundTrip({
      resolvedRoute,
      firstResponse: [
        {
          type: 'message_start',
          message: {
            id: 'message-1',
            model: resolvedRoute.endpoint_model_id,
            role: 'assistant',
            usage: { input_tokens: 12, cache_read_input_tokens: 3 },
          },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: '先读取文件。' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'signature_delta', signature: 'signed-1' },
        },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 'call-1', name: 'read_file', input: {} },
        },
        {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"path":"/tmp/a"}' },
        },
        { type: 'content_block_stop', index: 1 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'tool_use', stop_sequence: null },
          usage: { output_tokens: 6 },
        },
        { type: 'message_stop' },
      ],
      secondResponse: [
        {
          type: 'message_start',
          message: {
            id: 'message-2',
            model: resolvedRoute.endpoint_model_id,
            role: 'assistant',
            usage: { input_tokens: 20 },
          },
        },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: '读取完成。' },
        },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 3 },
        },
        { type: 'message_stop' },
      ],
    });

    expect(result.requests).toHaveLength(2);
    expect(result.requests[0]?.url).toBe('https://fixture.invalid/v1/messages');
    expect(result.requests[0]?.headers.get('x-api-key')).toBe('fixture-secret');
    expect(result.requests[0]?.headers.get('authorization')).toBeNull();
    expect(result.requests[0]?.headers.get('anthropic-version')).toBe('2023-06-01');
    expect(result.requests[0]?.body).toMatchObject({
      model: 'MiniMax-M2.7',
      stream: true,
      tools: [{ name: 'read_file' }],
    });
    expect(result.requests[0]?.body).toHaveProperty('tool_choice', { type: 'auto' });
    expect(result.replay).toEqual([
      {
        type: 'reasoning',
        text: '先读取文件。',
        continuation: [
          {
            schema_version: 2,
            producer: {
              model_id: resolvedRoute.model_id,
              endpoint_id: resolvedRoute.endpoint_id,
              api_surface: resolvedRoute.surface,
              capability_id: resolvedRoute.capability_id,
              endpoint_model_id: resolvedRoute.endpoint_model_id,
            },
            kind: 'ai-sdk:anthropic-reasoning',
            payload: {
              target: 'reasoning',
              text: '先读取文件。',
              signature: 'signed-1',
            },
          },
        ],
      },
      {
        type: 'tool_call',
        call: { id: 'call-1', name: 'read_file', arguments: { path: '/tmp/a' } },
      },
    ]);
    expect(result.requests[1]?.body).toMatchObject({
      messages: [
        { role: 'user', content: [{ type: 'text', text: '读取文件' }] },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: '先读取文件。', signature: 'signed-1' },
            { type: 'tool_use', id: 'call-1', name: 'read_file', input: { path: '/tmp/a' } },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'call-1',
              content: 'file contents',
            },
          ],
        },
      ],
    });
    expect(result.requests[1]?.body).toHaveProperty('tool_choice', { type: 'auto' });
    expect(result.secondEvents[result.secondEvents.length - 1]).toEqual({
      type: 'finish',
      reason: 'stop',
    });
  });
});
