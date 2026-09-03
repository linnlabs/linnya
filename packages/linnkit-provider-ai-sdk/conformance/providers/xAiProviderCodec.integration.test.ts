import { describe, expect, it } from 'vitest';

import { route, runToolRoundTrip } from '../fixtures/dedicatedProviderCodecFixture';

function completedResponse(args: {
  readonly id: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
}) {
  return {
    type: 'response.completed',
    response: {
      id: args.id,
      created_at: 1,
      model: args.model,
      object: 'response',
      output: [],
      usage: {
        input_tokens: args.inputTokens,
        output_tokens: args.outputTokens,
        total_tokens: args.inputTokens + args.outputTokens,
        output_tokens_details: { reasoning_tokens: args.reasoningTokens },
      },
      status: 'completed',
      service_tier: null,
    },
  };
}

describe('dedicated Provider package codec conformance', () => {
  it('xAI Responses 由官方 codec 完成 reasoning、工具调用、usage 与第二轮回放', async () => {
    const resolvedRoute = route({
      capabilityId: 'ai-sdk:xai-responses',
      surface: 'openai_responses',
      authProfile: 'bearer',
      providerModelId: 'grok-4.1-fast-reasoning',
    });
    const reasoningItem = {
      type: 'reasoning',
      id: 'reasoning-1',
      summary: [{ type: 'summary_text', text: '先读取文件。' }],
      content: null,
      status: 'completed',
      encrypted_content: 'encrypted-1',
    };
    const result = await runToolRoundTrip({
      resolvedRoute,
      firstResponse: [
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: { ...reasoningItem, summary: [], status: 'in_progress' },
        },
        {
          type: 'response.reasoning_summary_part.added',
          item_id: 'reasoning-1',
          output_index: 0,
          summary_index: 0,
          part: { type: 'summary_text', text: '' },
        },
        {
          type: 'response.reasoning_summary_text.delta',
          item_id: 'reasoning-1',
          output_index: 0,
          summary_index: 0,
          delta: '先读取文件。',
        },
        {
          type: 'response.reasoning_summary_part.done',
          item_id: 'reasoning-1',
          output_index: 0,
          summary_index: 0,
          part: { type: 'summary_text', text: '先读取文件。' },
        },
        { type: 'response.output_item.done', output_index: 0, item: reasoningItem },
        {
          type: 'response.output_item.added',
          output_index: 1,
          item: {
            type: 'function_call',
            id: 'function-1',
            call_id: 'call-1',
            name: 'read_file',
            arguments: '',
          },
        },
        {
          type: 'response.function_call_arguments.delta',
          item_id: 'function-1',
          output_index: 1,
          delta: '{"path":"/tmp/a"}',
        },
        {
          type: 'response.output_item.done',
          output_index: 1,
          item: {
            type: 'function_call',
            id: 'function-1',
            call_id: 'call-1',
            name: 'read_file',
            arguments: '{"path":"/tmp/a"}',
          },
        },
        completedResponse({
          id: 'response-1',
          model: resolvedRoute.endpoint_model_id,
          inputTokens: 17,
          outputTokens: 6,
          reasoningTokens: 2,
        }),
      ],
      secondResponse: [
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: {
            type: 'message',
            role: 'assistant',
            content: [],
            id: 'message-2',
            status: 'in_progress',
          },
        },
        {
          type: 'response.output_text.delta',
          item_id: 'message-2',
          output_index: 0,
          content_index: 0,
          delta: '读取完成。',
        },
        completedResponse({
          id: 'response-2',
          model: resolvedRoute.endpoint_model_id,
          inputTokens: 24,
          outputTokens: 3,
          reasoningTokens: 0,
        }),
      ],
      toolResultContent: [
        { type: 'text', text: 'file contents' },
        { type: 'image', media_type: 'image/png', bytes: new Uint8Array([1, 2, 3]) },
      ],
    });

    expect(result.requests).toHaveLength(2);
    expect(result.requests[0]?.url).toBe('https://fixture.invalid/v1/responses');
    expect(result.requests[0]?.headers.get('authorization')).toBe('Bearer fixture-secret');
    expect(result.requests[0]?.body).toMatchObject({
      model: 'grok-4.1-fast-reasoning',
      stream: true,
      tools: [{ type: 'function', name: 'read_file' }],
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
      store: false,
      input: expect.arrayContaining([
        expect.objectContaining({
          type: 'reasoning',
          id: 'reasoning-1',
          encrypted_content: 'encrypted-1',
        }),
        expect.objectContaining({
          type: 'function_call',
          call_id: 'call-1',
          name: 'read_file',
        }),
        expect.objectContaining({
          type: 'function_call_output',
          call_id: 'call-1',
          output: [
            { type: 'input_text', text: 'file contents' },
            { type: 'input_image', image_url: 'data:image/png;base64,AQID' },
          ],
        }),
      ]),
    });
    expect(result.secondEvents[result.secondEvents.length - 1]).toEqual({
      type: 'finish',
      reason: 'stop',
    });
  });
});
