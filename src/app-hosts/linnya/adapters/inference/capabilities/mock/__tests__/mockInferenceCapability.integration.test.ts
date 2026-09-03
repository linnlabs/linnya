import { describe, expect, it } from 'vitest';
import type { CanonicalInferenceEvent, CanonicalInferenceRequest } from '@linnlabs/linnkit/ports';
import type { ResolvedInferenceAttemptRoute } from '../../../definitions/inferenceCapability';
import { createMockInferenceCapability } from '../orchestration/createMockInferenceCapability';

const route: ResolvedInferenceAttemptRoute = {
  model_id: 'mock-model',
  route_profile_id: 'mock',
  api_surface: 'mock',
  capability_id: 'host:mock',
  endpoint_id: 'synthetic',
  endpoint_model_id: 'synthetic-chat',
  base_url: 'mock://inference?delay_ms=0&chunk_size=200',
  auth_profile: 'none',
  context_window_tokens: 16_384,
  max_output_tokens: 2_048,
  input_support: { user_image: false, tool_result_image: false },
  usage: { response_usage: 'unavailable' },
  continuation: { tool_replay: 'unavailable' },
};

function request(overrides: Partial<CanonicalInferenceRequest> = {}): CanonicalInferenceRequest {
  return {
    model_id: 'mock-model',
    messages: [{ role: 'user', content: [{ type: 'text', text: '测试' }] }],
    tools: [],
    tool_choice: 'none',
    sampling: {},
    invocation: { trace_id: 'trace-1', attempt_id: 'attempt-1' },
    ...overrides,
  };
}

async function collectEvents(
  inferenceRequest: CanonicalInferenceRequest,
  attemptRoute: ResolvedInferenceAttemptRoute = route,
): Promise<CanonicalInferenceEvent[]> {
  const events: CanonicalInferenceEvent[] = [];
  for await (const event of createMockInferenceCapability().stream({
    request: inferenceRequest,
    route: attemptRoute,
  })) {
    events.push(event);
  }
  return events;
}

describe('canonical mock inference capability', () => {
  it('从内聚脚本直接产生 canonical reasoning/text/终态', async () => {
    const events = await collectEvents(request());

    expect(events).toEqual([
      { type: 'start', model_id: 'mock-model', attempt_id: 'attempt-1' },
      { type: 'thought_delta', text: '### Mock 思考\ncontent_fast：快速输出思考。\n' },
      {
        type: 'assistant_part_end',
        index: 0,
        part: { type: 'reasoning', text: '### Mock 思考\ncontent_fast：快速输出思考。\n' },
      },
      {
        type: 'answer_delta',
        text: 'content_fast：快速输出正文，用于测试 chunk 拼接与 markdown 渲染。',
      },
      {
        type: 'assistant_part_end',
        index: 1,
        part: {
          type: 'text',
          text: 'content_fast：快速输出正文，用于测试 chunk 拼接与 markdown 渲染。',
        },
      },
      { type: 'finish', reason: 'stop' },
    ]);
  });

  it('工具脚本只能调用当前 canonical request 显式暴露的工具', async () => {
    const toolRoute = {
      ...route,
      base_url: 'mock://inference?preset=tool_call&tool=read_probe&delay_ms=0&chunk_size=200',
    };
    const events = await collectEvents(request({
      tools: [{
        name: 'read_probe',
        description: '读取测试目标',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: '路径' } },
          required: ['path'],
        },
      }],
      tool_choice: 'auto',
    }), toolRoute);

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool_call_start', name: 'read_probe' }),
      expect.objectContaining({ type: 'tool_argument_delta', json_delta: JSON.stringify({ path: '测试' }) }),
      expect.objectContaining({
        type: 'tool_call_end',
        call: expect.objectContaining({ name: 'read_probe', arguments: { path: '测试' } }),
      }),
      { type: 'finish', reason: 'tool_use' },
    ]));

    await expect(collectEvents(request(), toolRoute)).resolves.toEqual([
      { type: 'start', model_id: 'mock-model', attempt_id: 'attempt-1' },
      expect.objectContaining({
        type: 'thought_delta',
      }),
      expect.objectContaining({
        type: 'assistant_part_end',
      }),
      { type: 'failure', kind: 'protocol', code: 'mock_tool_not_registered', retryable: false },
    ]);
  });
});
