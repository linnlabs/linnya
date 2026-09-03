import { describe, expect, it } from 'vitest';

import type { ByokLiveSmokeConfiguration } from '../definitions/byokLiveSmoke';
import { runByokLiveSmoke } from './runByokLiveSmoke';

function eventStream(events: readonly Record<string, unknown>[]): Response {
  const body = `${events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`;
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('BYOK live smoke orchestration', () => {
  it('用所选正式 codec 完成工具调用、结果回放、usage 与精确两次请求', async () => {
    const requestBodies: unknown[] = [];
    const fixtureFetch: typeof fetch = async (_input, init) => {
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
});
