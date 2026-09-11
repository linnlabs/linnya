import type { CanonicalInferenceRequest, ProviderContinuation } from '@linnlabs/linnkit/ports';
import { describe, expect, it } from 'vitest';
import type { AiSdkInferenceRoute } from '../definitions/aiSdkInferenceSurface';
import {
  projectAiSdkGenerationSettings,
  projectAiSdkRequestProviderOptions,
  projectCanonicalToolConfiguration,
} from './projectCanonicalRequestToAiSdk';
import { projectCanonicalMessages } from './projectCanonicalMessages';

const route: AiSdkInferenceRoute = {
  model_id: 'model-1',
  request_profile: 'openai_responses',
  capability_id: 'ai-sdk:openai-responses',
  endpoint_id: 'openai',
  endpoint_model_id: 'gpt-5',
  surface: 'openai_responses',
  base_url: 'https://api.openai.com/v1',
};

function continuation(
  kind: ProviderContinuation['kind'],
  payload: ProviderContinuation['payload']
): ProviderContinuation {
  return {
    schema_version: 2,
    producer: {
      model_id: route.model_id,
      endpoint_id: route.endpoint_id,
      api_surface: route.surface,
      capability_id: route.capability_id,
      endpoint_model_id: route.endpoint_model_id,
    },
    kind,
    payload,
  };
}

function request(): CanonicalInferenceRequest {
  return {
    model_id: route.model_id,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    tools: [{
      name: 'read_file',
      description: 'Read one file',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Path' } },
        required: ['path'],
        additionalProperties: false,
      },
    }],
    tool_choice: { type: 'tool', name: 'read_file' },
    sampling: {},
    invocation: { trace_id: 'trace-1', attempt_id: 'attempt-1' },
  };
}

describe('projectCanonicalRequestToAiSdk', () => {
  it('把 canonical none 投影为不发送 Responses reasoning 字段', () => {
    const settings = projectAiSdkGenerationSettings(
      {
        ...request(),
        sampling: { reasoning_effort: 'none' },
      },
      {
        ...route,
        request_profile: 'chatgpt_codex_responses',
        endpoint_model_id: 'gpt-6-astra',
      },
    );

    expect(settings).not.toHaveProperty('reasoning');
  });

  it('把有效 reasoning 档位投影为 Responses reasoning 字段', () => {
    const settings = projectAiSdkGenerationSettings(
      {
        ...request(),
        sampling: { reasoning_effort: 'medium' },
      },
      {
        ...route,
        request_profile: 'chatgpt_codex_responses',
        endpoint_model_id: 'gpt-6-astra',
      },
    );

    expect(settings).toEqual({ reasoning: 'medium' });
  });

  it('原样投影 JSON Schema，工具对象不具有 execute 或 approval 能力', () => {
    const input = request();
    const configuration = projectCanonicalToolConfiguration(input);
    const tools = configuration.tools;
    if (!tools) throw new Error('期望投影出工具配置');
    expect(tools.read_file).toBeDefined();
    expect(tools.read_file).not.toHaveProperty('execute');
    expect(tools.read_file).not.toHaveProperty('needsApproval');
    expect(tools.read_file?.inputSchema).toBeDefined();
    expect(configuration.toolChoice).toEqual({
      type: 'tool',
      toolName: 'read_file',
    });
  });

  it('没有候选工具时省略整个 AI SDK 工具配置', () => {
    const input = request();
    expect(projectCanonicalToolConfiguration({
      ...input,
      tools: [],
      tool_choice: 'auto',
    })).toEqual({});
  });

  it('有候选工具时仍省略 canonical auto，只保留工具定义', () => {
    const input = request();
    const configuration = projectCanonicalToolConfiguration({
      ...input,
      tool_choice: 'auto',
    });

    expect(configuration.tools?.read_file).toBeDefined();
    expect(configuration).not.toHaveProperty('toolChoice');
  });

  it('有序工具与 none 可以同时进入统一 AI SDK 请求', () => {
    const input = request();
    const configuration = projectCanonicalToolConfiguration({
      ...input,
      tools: [
        ...input.tools,
        {
          name: 'write_file',
          description: 'Write one file',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string', description: 'Path' } },
            required: ['path'],
            additionalProperties: false,
          },
        },
      ],
      tool_choice: 'none',
    });

    expect(Object.keys(configuration.tools ?? {})).toEqual(['read_file', 'write_file']);
    expect(configuration.toolChoice).toBe('none');
  });

  it('只为正式声明支持的 Anthropic capability 投影稳定前缀消息断点', () => {
    const messages: CanonicalInferenceRequest['messages'] = [
      { role: 'system', content: 'ROOT_SYSTEM' },
      { role: 'system', content: 'HISTORY_SUMMARY' },
      { role: 'system', content: 'CONTEXT_COMPACTION' },
      { role: 'user', content: [{ type: 'text', text: 'CURRENT_GOAL' }] },
    ];
    const cachePolicy: NonNullable<CanonicalInferenceRequest['cache_policy']> = {
      breakpoints: [
        { anchor: 'end_of_system_prompt', message_index: 0 },
        { anchor: 'end_of_history_summary', message_index: 1 },
      ],
    };

    const openAiMessages = projectCanonicalMessages(messages, route, cachePolicy);
    expect(openAiMessages.every(message => !('providerOptions' in message))).toBe(true);

    const anthropicMessages = projectCanonicalMessages(messages, {
      ...route,
      request_profile: 'anthropic_messages',
      capability_id: 'ai-sdk:anthropic-messages',
      surface: 'anthropic_messages',
    }, cachePolicy);
    expect(anthropicMessages[0]).toMatchObject({
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    });
    expect(anthropicMessages[1]).toMatchObject({
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    });

    const miniMaxMessages = projectCanonicalMessages(messages, {
      ...route,
      request_profile: 'minimax_chat',
      capability_id: 'ai-sdk:minimax',
      surface: 'anthropic_messages',
    }, cachePolicy);
    expect(miniMaxMessages.every(message => !('providerOptions' in message))).toBe(true);

    const codexMessages = projectCanonicalMessages(messages, {
      ...route,
      request_profile: 'chatgpt_codex_responses',
    }, cachePolicy);
    expect(codexMessages.every(message => !('providerOptions' in message))).toBe(true);

    const googleMessages = projectCanonicalMessages(messages, {
      ...route,
      request_profile: 'google_generative_ai',
      capability_id: 'ai-sdk:google-generative-ai',
      surface: 'google_generative_ai',
    }, cachePolicy);
    expect(googleMessages.every(message => !('providerOptions' in message))).toBe(true);
  });

  it('从已完成 assistant tool call 严格解析 tool result 的名字并保留图片 bytes', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const messages = projectCanonicalMessages([
      {
        role: 'assistant',
        parts: [{
          type: 'tool_call',
          call: { id: 'call-1', name: 'read_file', arguments: { path: '/a' } },
        }],
      },
      {
        role: 'tool',
        tool_call_id: 'call-1',
        content: [
          { type: 'text', text: 'done' },
          { type: 'image', media_type: 'image/png', bytes },
        ],
      },
    ], route);
    expect(messages[1]).toEqual({
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: 'call-1',
        toolName: 'read_file',
        output: {
          type: 'content',
          value: [
            { type: 'text', text: 'done' },
            {
              type: 'file',
              data: { type: 'data', data: bytes },
              mediaType: 'image/png',
            },
          ],
        },
      }],
    });
  });

  it('拒绝没有 assistant producer 的孤立 tool result', () => {
    expect(() => projectCanonicalMessages([{
      role: 'tool',
      tool_call_id: 'missing',
      content: [{ type: 'text', text: 'done' }],
    }], route)).toThrow(/找不到已完成的 assistant tool call/);
  });

  it('把 OpenAI Responses reasoning 与 tool item metadata 还原为 part providerOptions', () => {
    const messages = projectCanonicalMessages([{
      role: 'assistant',
      parts: [
        {
          type: 'reasoning',
          text: 'thinking',
          continuation: [continuation('ai-sdk:openai-responses-part', {
            target: 'reasoning',
            text: 'thinking',
            item_id: 'reasoning-1',
            reasoning_encrypted_content: 'encrypted',
          })],
        },
        { type: 'text', text: 'answer' },
        {
          type: 'tool_call',
          call: {
            id: 'call-1',
            name: 'read_file',
            arguments: { path: '/a' },
            continuation: [continuation('ai-sdk:openai-responses-part', {
              target: 'tool_call',
              tool_call_id: 'call-1',
              item_id: 'item-call-1',
            })],
          },
        },
      ],
    }], route);
    expect(messages[0]).toEqual({
      role: 'assistant',
      content: [
        {
          type: 'reasoning',
          text: 'thinking',
          providerOptions: {
            openai: {
              itemId: 'reasoning-1',
              reasoningEncryptedContent: 'encrypted',
            },
          },
        },
        { type: 'text', text: 'answer' },
        {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'read_file',
          input: { path: '/a' },
          providerOptions: { openai: { itemId: 'item-call-1' } },
        },
      ],
    });
  });

  it('把 xAI Responses continuation 和无状态请求选项投影到 xai namespace', () => {
    const xAiRoute = {
      ...route,
      capability_id: 'ai-sdk:xai-responses',
      endpoint_id: 'xai',
      endpoint_model_id: 'grok-4.1-fast-reasoning',
    } satisfies AiSdkInferenceRoute;
    const xAiContinuation: ProviderContinuation = {
      schema_version: 2,
      producer: {
        model_id: xAiRoute.model_id,
        endpoint_id: xAiRoute.endpoint_id,
        api_surface: xAiRoute.surface,
        capability_id: xAiRoute.capability_id,
        endpoint_model_id: xAiRoute.endpoint_model_id,
      },
      kind: 'ai-sdk:xai-responses-part',
      payload: {
        target: 'reasoning',
        text: 'thinking',
        item_id: 'reasoning-1',
        reasoning_encrypted_content: 'encrypted',
      },
    };

    expect(projectCanonicalMessages([{
      role: 'assistant',
      parts: [{ type: 'reasoning', text: 'thinking', continuation: [xAiContinuation] }],
    }], xAiRoute)).toEqual([{
      role: 'assistant',
      content: [{
        type: 'reasoning',
        text: 'thinking',
        providerOptions: {
          xai: { itemId: 'reasoning-1', reasoningEncryptedContent: 'encrypted' },
        },
      }],
    }]);
    expect(projectAiSdkRequestProviderOptions(request(), xAiRoute)).toEqual({
      xai: { store: false },
    });
  });

  it('模型切换时跳过旧 route continuation，并保留 canonical Assistant 与工具历史', () => {
    const switchedRoute = {
      ...route,
      model_id: 'glm-model',
      request_profile: 'openai_compatible_chat',
      capability_id: 'ai-sdk:openai-compatible',
      endpoint_id: 'opencode-go',
      endpoint_model_id: 'glm-5.3-flash',
      surface: 'openai_chat_completions',
    } satisfies AiSdkInferenceRoute;
    const oldRouteContinuation = continuation('ai-sdk:openai-responses-part', {
      target: 'reasoning',
      text: 'thinking',
      item_id: 'reasoning-1',
    });

    expect(projectCanonicalMessages([
      {
        role: 'assistant',
        parts: [
          {
            type: 'reasoning',
            text: 'thinking',
            continuation: [oldRouteContinuation],
          },
          { type: 'text', text: 'answer' },
          {
            type: 'tool_call',
            call: {
              id: 'call-1',
              name: 'read_file',
              arguments: { path: '/a' },
              continuation: [{
                ...oldRouteContinuation,
                payload: {
                  target: 'tool_call',
                  tool_call_id: 'call-1',
                  item_id: 'item-call-1',
                },
              }],
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call-1',
        content: [{ type: 'text', text: 'done' }],
      },
    ], switchedRoute)).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'thinking' },
          { type: 'text', text: 'answer' },
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'read_file',
            input: { path: '/a' },
          },
        ],
      },
      {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'read_file',
          output: { type: 'text', value: 'done' },
        }],
      },
    ]);
  });

  it('tool continuation 必须绑定当前 tool part', () => {
    expect(() => projectCanonicalMessages([{
      role: 'assistant',
      parts: [{
        type: 'tool_call',
        call: {
          id: 'call-1',
          name: 'read_file',
          arguments: { path: '/a' },
          continuation: [continuation('ai-sdk:openai-responses-part', {
            target: 'tool_call',
            tool_call_id: 'call-other',
            item_id: 'item-call-1',
          })],
        },
      }],
    }], route)).toThrow(/tool_call_id 与 assistant tool part 不一致/);
  });
});
