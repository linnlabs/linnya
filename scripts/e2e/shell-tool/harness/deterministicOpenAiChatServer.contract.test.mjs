import { afterEach, describe, expect, it } from 'vitest';

import { createLinnyaAiSdkInferenceCapability } from '../../../../src/app-hosts/linnya/adapters/inference/features/ai-sdk-language-composition/orchestration/createLinnyaAiSdkInferenceCapability.ts';
import { createLinnyaAiSdkLanguageModelRegistry } from '../../../../src/app-hosts/linnya/adapters/inference/features/ai-sdk-language-composition/orchestration/createLinnyaAiSdkLanguageModelRegistry.ts';

import {
  startDeterministicOpenAiChatServer,
} from './deterministicOpenAiChatServer.mjs';

const PROCESS_HANDLE = 'command_process_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2d';
const SHELL_CALL_ID = 'call-shell';
const PROCESS_CALL_ID = 'call-process';
const servers = [];

function commandToolResult() {
  return JSON.stringify({
    data: { status: 'running' },
    observation: `command_control: ${JSON.stringify({
      protocol_version: 1,
      kind: 'shell_model_control',
      status: 'running',
      process_handle: PROCESS_HANDLE,
      next_cursor: 17,
    })}\n\noutput:\nstarted`,
  });
}

function inferenceRoute(apiBase) {
  return {
    model_id: 'deterministic-full-app-model',
    capability_id: 'ai-sdk:openai-chat',
    endpoint_id: 'deterministic-openai',
    endpoint_model_id: 'deterministic-chat-model',
    api_surface: 'openai_chat_completions',
    base_url: apiBase,
    auth_profile: 'bearer',
    context_window_tokens: 32_000,
    max_output_tokens: 2_048,
    input_support: { user_image: false, tool_result_image: false },
    usage: { response_usage: 'provider_reported_optional' },
    continuation: { tool_replay: 'optional' },
  };
}

function toolSchemas() {
  return [
    {
      name: 'shell',
      description: 'Run command',
      parameters: { type: 'object', properties: {}, additionalProperties: true },
    },
    {
      name: 'process',
      description: 'Control process',
      parameters: { type: 'object', properties: {}, additionalProperties: true },
    },
  ];
}

function rawChatRequest(apiBase, content = 'fixture request') {
  return globalThis.fetch(`${apiBase}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'm',
      stream: true,
      messages: [{ role: 'user', content }],
      tools: [],
    }),
  });
}

function canonicalRequest(messages, attemptId) {
  return {
    model_id: 'deterministic-full-app-model',
    messages,
    tools: toolSchemas(),
    tool_choice: 'auto',
    sampling: {},
    invocation: { trace_id: 'deterministic-full-app', attempt_id: attemptId },
  };
}

function createCapability() {
  return createLinnyaAiSdkInferenceCapability(
    'ai-sdk:openai-chat',
    'openai_chat_completions',
    { language_models: createLinnyaAiSdkLanguageModelRegistry() },
  );
}

async function invokeCapability(apiBase, messages, attemptId) {
  const events = [];
  for await (const event of createCapability().stream({
    request: canonicalRequest(messages, attemptId),
    route: inferenceRoute(apiBase),
    credential: { profile: 'bearer', secret: 'contract-secret-that-must-not-be-observed' },
  })) {
    events.push(event);
  }
  return events;
}

function collectToolCall(events) {
  const event = events.find(candidate => candidate.type === 'tool_call_end');
  if (!event) {
    throw new Error(
      `Expected one canonical tool_call_end event; received ${JSON.stringify(events)}.`,
    );
  }
  return event.call;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()));
});

describe('deterministic OpenAI-compatible full App harness', () => {
  it('接收生产 AI SDK capability 的真实请求，并从上一轮工具结果生成 process 参数', async () => {
    const server = await startDeterministicOpenAiChatServer({
      sessions: {
        'conversation-a': [
          {
            kind: 'tool_call',
            id: SHELL_CALL_ID,
            name: 'shell',
            arguments: {
              kind: 'fixed',
              value: { command: 'fixture-long-command', initial_wait_ms: 250 },
            },
          },
          {
            kind: 'tool_call',
            id: PROCESS_CALL_ID,
            name: 'process',
            arguments: {
              kind: 'process_from_tool_result',
              sourceToolCallId: SHELL_CALL_ID,
              action: { type: 'wait', wait_timeout_ms: 2_000 },
              useNextCursor: true,
            },
            hold: 'before-process-response',
          },
          { kind: 'assistant_text', id: 'done', content: '流程完成。' },
        ],
      },
    });
    servers.push(server);
    const first = await invokeCapability(server.apiBaseFor('conversation-a'), [
      { role: 'user', content: [{ type: 'text', text: 'SENSITIVE_USER_PROMPT' }] },
    ], 'attempt-shell');
    const shellCall = collectToolCall(first);
    expect(shellCall).toEqual({
      id: SHELL_CALL_ID,
      name: 'shell',
      arguments: { command: 'fixture-long-command', initial_wait_ms: 250 },
    });
    expect(first.at(-1)).toEqual({ type: 'finish', reason: 'tool_use' });

    const secondRequest = invokeCapability(server.apiBaseFor('conversation-a'),
      [
        { role: 'user', content: [{ type: 'text', text: 'SENSITIVE_USER_PROMPT' }] },
        {
          role: 'assistant',
          parts: [{ type: 'tool_call', call: shellCall }],
        },
        {
          role: 'tool',
          tool_call_id: SHELL_CALL_ID,
          content: [{ type: 'text', text: commandToolResult() }],
        },
      ],
      'attempt-process',
    );
    await server.waitUntilHeld('conversation-a', 'before-process-response');
    let secondSettled = false;
    void secondRequest.then(() => { secondSettled = true; });
    await Promise.resolve();
    expect(secondSettled).toBe(false);
    server.release('conversation-a', 'before-process-response');

    const processCall = collectToolCall(await secondRequest);
    expect(processCall).toEqual({
      id: PROCESS_CALL_ID,
      name: 'process',
      arguments: {
        process_handle: PROCESS_HANDLE,
        action: { type: 'wait', wait_timeout_ms: 2_000, cursor: 17 },
      },
    });

    const finalEvents = await invokeCapability(server.apiBaseFor('conversation-a'), [
      { role: 'user', content: [{ type: 'text', text: 'final turn' }] },
    ], 'attempt-final');
    expect(finalEvents).toContainEqual({ type: 'answer_delta', text: '流程完成。' });
    server.assertComplete();

    const observationJson = JSON.stringify(server.observations());
    expect(server.observations()).toMatchObject([
      { sessionId: 'conversation-a', sequence: 0, messageCount: 1, toolCount: 2, latestRole: 'user' },
      { sessionId: 'conversation-a', sequence: 1, messageCount: 3, toolCount: 2, latestRole: 'tool', state: 'held' },
      { sessionId: 'conversation-a', sequence: 2, messageCount: 1, toolCount: 2, latestRole: 'user' },
    ]);
    expect(observationJson).not.toMatch(
      /SENSITIVE_USER_PROMPT|fixture-long-command|command_process_|contract-secret|started|流程完成/,
    );
  });

  it('拒绝超限请求且错误响应不回显正文', async () => {
    const server = await startDeterministicOpenAiChatServer({
      maxRequestBytes: 128,
      sessions: {
        limited: [{ kind: 'assistant_text', id: 'unused', content: '不会发送' }],
      },
    });
    servers.push(server);

    const secret = 'BODY_SECRET'.repeat(64);
    const response = await globalThis.fetch(`${server.apiBaseFor('limited')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'm', stream: true, messages: [{ role: 'user', content: secret }], tools: [] }),
    });
    expect(response.status).toBe(413);
    expect(await response.text()).not.toContain('BODY_SECRET');
    expect(server.observations()).toEqual([]);
  });

  it('拒绝超限脚本响应且错误响应和观察记录都不保存正文', async () => {
    const server = await startDeterministicOpenAiChatServer({
      maxResponseBytes: 128,
      sessions: {
        limited: [{
          kind: 'assistant_text',
          id: 'oversized-response',
          content: 'RESPONSE_SECRET'.repeat(64),
        }],
      },
    });
    servers.push(server);

    const response = await globalThis.fetch(`${server.apiBaseFor('limited')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'm',
        stream: true,
        messages: [{ role: 'user', content: 'REQUEST_SECRET' }],
        tools: [],
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.text()).not.toMatch(/RESPONSE_SECRET|REQUEST_SECRET/);
    expect(JSON.stringify(server.observations())).not.toMatch(/RESPONSE_SECRET|REQUEST_SECRET/);
  });

  it('不同 session 可并行等待，同一 session 的重入请求不会重复消费脚本游标', async () => {
    const server = await startDeterministicOpenAiChatServer({
      sessions: {
        first: [{ kind: 'assistant_text', id: 'first', content: 'first done', hold: 'gate' }],
        second: [{ kind: 'assistant_text', id: 'second', content: 'second done', hold: 'gate' }],
      },
    });
    servers.push(server);

    const firstResponse = rawChatRequest(server.apiBaseFor('first'));
    const secondResponse = rawChatRequest(server.apiBaseFor('second'));
    await Promise.all([
      server.waitUntilHeld('first', 'gate'),
      server.waitUntilHeld('second', 'gate'),
    ]);

    const reentrant = await rawChatRequest(server.apiBaseFor('first'));
    expect(reentrant.status).toBe(409);
    expect(await reentrant.json()).toEqual({ error: { code: 'session_request_in_flight' } });

    server.release('first', 'gate');
    server.release('second', 'gate');
    const [firstSettled, secondSettled] = await Promise.all([firstResponse, secondResponse]);
    expect(firstSettled.status).toBe(200);
    expect(secondSettled.status).toBe(200);
    await Promise.all([firstSettled.text(), secondSettled.text()]);
    server.assertComplete();
    expect(server.observations()).toMatchObject([
      { sessionId: 'first', sequence: 0, state: 'held' },
      { sessionId: 'second', sequence: 0, state: 'held' },
    ]);
  });

  it('畸形 session URL 稳定返回 404，且无脚本和观察事实被消费', async () => {
    const server = await startDeterministicOpenAiChatServer({
      sessions: {
        valid: [{ kind: 'assistant_text', id: 'unused', content: 'unused' }],
      },
    });
    servers.push(server);

    const response = await globalThis.fetch(`${server.origin}/sessions/%/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(404);
    expect(server.observations()).toEqual([]);
  });

  it('容量上限必须是正整数，避免关闭上限或产生不明确的边界行为', async () => {
    await expect(startDeterministicOpenAiChatServer({
      maxRequestBytes: 0,
      sessions: {
        invalid: [{ kind: 'assistant_text', id: 'unused', content: 'unused' }],
      },
    })).rejects.toThrow('maxRequestBytes 必须是正整数');
  });

  it('关闭服务会结算尚未到达的 hold 等待者，不把失败测试拖到全局超时', async () => {
    const server = await startDeterministicOpenAiChatServer({
      sessions: {
        pending: [{ kind: 'assistant_text', id: 'unused', content: 'unused', hold: 'never-arrived' }],
      },
    });
    const waitForArrival = server.waitUntilHeld('pending', 'never-arrived');
    await server.close();
    await expect(waitForArrival).rejects.toThrow('closed before hold arrival');
  });
});
