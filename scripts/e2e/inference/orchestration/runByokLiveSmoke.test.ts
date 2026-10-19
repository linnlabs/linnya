import { describe, expect, it } from 'vitest';

import type { ByokLiveSmokeConfiguration } from '../definitions/byokLiveSmoke';
import { readByokLiveSmokeConfiguration } from '../functions/readByokLiveSmokeConfiguration';
import { runByokLiveSmoke } from './runByokLiveSmoke';

function eventStream(events: readonly Record<string, unknown>[]): Response {
  const body = `${events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`;
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function responsesEvents(first: boolean): readonly Record<string, unknown>[] {
  return [
    ...(first ? [
      {
        type: 'response.output_item.added', output_index: 0,
        item: { type: 'function_call', id: 'function-1', call_id: 'call-1',
          name: 'report_status', arguments: '' },
      },
      { type: 'response.function_call_arguments.delta', output_index: 0,
        item_id: 'function-1', delta: '{"status":"OK"}' },
      {
        type: 'response.output_item.done', output_index: 0,
        item: { type: 'function_call', id: 'function-1', call_id: 'call-1',
          name: 'report_status', arguments: '{"status":"OK"}', status: 'completed' },
      },
    ] : [
      { type: 'response.output_item.added', output_index: 0,
        item: { type: 'message', id: 'message-2', phase: 'final_answer' } },
      { type: 'response.output_text.delta', output_index: 0, item_id: 'message-2', delta: 'OK' },
      { type: 'response.output_item.done', output_index: 0,
        item: { type: 'message', id: 'message-2', phase: 'final_answer', content: [] } },
    ]),
    {
      type: 'response.completed',
      response: {
        incomplete_details: null, reasoning: null, service_tier: null,
        usage: { input_tokens: 12, output_tokens: 4,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 } },
      },
    },
  ];
}

function anthropicEvents(first: boolean): readonly Record<string, unknown>[] {
  return [
    { type: 'message_start', message: { id: first ? 'message-1' : 'message-2',
      model: 'fixture-model', role: 'assistant', usage: { input_tokens: 12 } } },
    ...(first ? [
      { type: 'content_block_start', index: 0,
        content_block: { type: 'tool_use', id: 'call-1', name: 'report_status', input: {} } },
      { type: 'content_block_delta', index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"status":"OK"}' } },
    ] : [
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } },
    ]),
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: first ? 'tool_use' : 'end_turn',
      stop_sequence: null }, usage: { output_tokens: 4 } },
    { type: 'message_stop' },
  ];
}

function chatEvents(first: boolean): readonly Record<string, unknown>[] {
  return [
    {
      id: first ? 'response-1' : 'response-2', created: 1, model: 'fixture-model',
      choices: [{ index: 0, delta: first
        ? { role: 'assistant', tool_calls: [{ index: 0, id: 'call-1', type: 'function',
            function: { name: 'report_status', arguments: '{"status":"OK"}' } }] }
        : { role: 'assistant', content: 'OK' }, finish_reason: null }],
    },
    {
      id: first ? 'response-1' : 'response-2', created: 1, model: 'fixture-model',
      choices: [{ index: 0, delta: {}, finish_reason: first ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
    },
  ];
}

describe('BYOK live smoke orchestration', () => {
  it('用所选正式 codec 完成工具调用、结果回放、usage 与精确两次请求', async () => {
    const requestBodies: unknown[] = [];
    const requestHeaders: Headers[] = [];
    const fixtureFetch: typeof fetch = async (_input, init) => {
      requestHeaders.push(new Headers(init?.headers));
      requestBodies.push(typeof init?.body === 'string' ? JSON.parse(init.body) : undefined);
      if (requestBodies.length === 1) {
        return eventStream([
          {
            id: 'response-1',
            created: 1,
            model: 'deepseek-chat',
            choices: [{
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [{
                  index: 0,
                  id: 'call-1',
                  type: 'function',
                  function: { name: 'report_status', arguments: '{"status":"OK"}' },
                }],
              },
              finish_reason: null,
            }],
          },
          {
            id: 'response-1',
            created: 1,
            model: 'deepseek-chat',
            choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
            usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
          },
        ]);
      }
      return eventStream([
        {
          id: 'response-2',
          created: 2,
          model: 'deepseek-chat',
          choices: [{
            index: 0,
            delta: { role: 'assistant', content: 'OK' },
            finish_reason: null,
          }],
        },
        {
          id: 'response-2',
          created: 2,
          model: 'deepseek-chat',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 18, completion_tokens: 1, total_tokens: 19 },
        },
      ]);
    };
    const configuration: ByokLiveSmokeConfiguration = {
      targets: [{
        id: 'deepseek',
        name: 'DeepSeek',
        provider_connection_definition_id: 'deepseek',
        route_profile_id: 'deepseek_chat',
        capability_id: 'ai-sdk:deepseek',
        surface: 'openai_chat_completions',
        endpoint_id: 'deepseek',
        endpoint_model_id: 'deepseek-chat',
        base_url: 'https://fixture.invalid',
        auth_profile: 'bearer',
        credential: 'fixture-secret',
      }],
    };
    const messages: string[] = [];

    await runByokLiveSmoke(configuration, message => messages.push(message), fixtureFetch);

    expect(requestBodies).toHaveLength(2);
    for (const headers of requestHeaders) {
      expect(headers.get('x-opencode-session')).toBeNull();
      expect(headers.get('user-agent')).toMatch(/^linnya\//);
    }
    expect(requestBodies[0]).toMatchObject({
      model: 'deepseek-chat',
      tool_choice: { type: 'function', function: { name: 'report_status' } },
    });
    expect(requestBodies[1]).toMatchObject({
      messages: [
        { role: 'user' },
        {
          role: 'assistant',
          tool_calls: [{ id: 'call-1', function: { name: 'report_status' } }],
        },
        { role: 'tool', tool_call_id: 'call-1', content: '{"status":"OK"}' },
      ],
    });
    expect(messages).toEqual([
      '[BYOK live smoke] 开始验证 DeepSeek',
      '[BYOK live smoke] DeepSeek 两轮工具闭环通过',
    ]);
  });

  it.each([
    { target: 'opencode-go-openai-compatible-chat', modelVariable: 'OPENAI_COMPATIBLE_CHAT',
      model: 'deepseek-v4.1-flash', events: chatEvents },
    { target: 'opencode-go-openai-responses', modelVariable: 'OPENAI_RESPONSES',
      model: 'gpt-5.6-luna', events: responsesEvents },
    { target: 'opencode-go-anthropic-messages', modelVariable: 'ANTHROPIC_MESSAGES',
      model: 'qwen3.8-max', events: anthropicEvents },
  ])('$target 经真实 Host 和 SDK 在两轮工具闭环携带相同会话头与自有 User-Agent', async fixture => {
    const configuration = readByokLiveSmokeConfiguration({
      LINNYA_BYOK_TARGETS: fixture.target,
      LINNYA_BYOK_OPENCODE_GO_API_KEY: 'fixture-secret',
      LINNYA_BYOK_OPENCODE_GO_BASE_URL: 'https://fixture.invalid/v1',
      [`LINNYA_BYOK_OPENCODE_GO_${fixture.modelVariable}_MODEL`]: fixture.model,
    });
    const requests: Request[] = [];
    const fixtureFetch: typeof fetch = async (input, init) => {
      requests.push(new Request(input, init));
      return eventStream(fixture.events(requests.length === 1));
    };

    await runByokLiveSmoke(configuration, () => undefined, fixtureFetch);

    expect(requests).toHaveLength(2);
    const sessions = requests.map(request => request.headers.get('x-opencode-session'));
    expect(sessions[0]).toMatch(/^byok-live-smoke-/);
    expect(sessions[1]).toBe(sessions[0]);
    for (const request of requests) {
      expect(request.headers.get('user-agent')).toMatch(/^linnya\//);
      expect(request.headers.get('authorization')).toBe('Bearer fixture-secret');
    }
  });

  it('上游拒绝时只执行一个 attempt，不重试或继续发起第二轮', async () => {
    const configuration = readByokLiveSmokeConfiguration({
      LINNYA_BYOK_TARGETS: 'opencode-go-openai-compatible-chat',
      LINNYA_BYOK_OPENCODE_GO_API_KEY: 'fixture-secret',
      LINNYA_BYOK_OPENCODE_GO_BASE_URL: 'https://fixture.invalid/v1',
      LINNYA_BYOK_OPENCODE_GO_OPENAI_COMPATIBLE_CHAT_MODEL: 'deepseek-v4.1-flash',
    });
    let requestCount = 0;
    const fixtureFetch: typeof fetch = async () => {
      requestCount += 1;
      return new Response(JSON.stringify({ error: { type: 'Missingsessionid' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    };

    await expect(runByokLiveSmoke(configuration, () => undefined, fixtureFetch))
      .rejects.toThrow('opencode_session_required');
    expect(requestCount).toBe(1);
  });
});
