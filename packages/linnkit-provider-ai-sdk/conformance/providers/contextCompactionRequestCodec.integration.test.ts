import type { CanonicalInferenceEvent, CanonicalInferenceRequest } from '@linnlabs/linnkit/ports';
import { describe, expect, it } from 'vitest';
import {
  createAiSdkInferenceCapability,
  createAiSdkLanguageModelRegistry,
  type AiSdkInferenceAuthProfile,
  type AiSdkInferenceCapabilityId,
  type AiSdkInferenceRoute,
  type AiSdkInferenceSurface,
} from '@linnlabs/linnkit-provider-ai-sdk';

type CodecFamily =
  | 'openai_chat'
  | 'zai_chat'
  | 'openai_responses'
  | 'chatgpt_codex'
  | 'anthropic_messages'
  | 'google_generative_ai'
  | 'cohere_chat';

interface CompactionCodecCase {
  readonly name: string;
  readonly requestProfile: string;
  readonly capabilityId: AiSdkInferenceCapabilityId;
  readonly surface: AiSdkInferenceSurface;
  readonly authProfile: AiSdkInferenceAuthProfile;
  readonly endpointModelId: string;
  readonly family: CodecFamily;
  readonly explicitCacheBreakpoints: boolean;
  readonly systemPrefixRole?: 'system' | 'developer';
}

const CASES: readonly CompactionCodecCase[] = [
  {
    name: 'OpenAI Chat',
    requestProfile: 'openai_chat',
    capabilityId: 'ai-sdk:openai-chat',
    surface: 'openai_chat_completions',
    authProfile: 'bearer',
    endpointModelId: 'gpt-fixture',
    family: 'openai_chat',
    explicitCacheBreakpoints: false,
  },
  {
    name: 'OpenAI-compatible / Ollama',
    requestProfile: 'openai_compatible_chat',
    capabilityId: 'ai-sdk:openai-compatible',
    surface: 'openai_chat_completions',
    authProfile: 'none',
    endpointModelId: 'qwen3',
    family: 'openai_chat',
    explicitCacheBreakpoints: false,
  },
  {
    name: 'OpenAI Responses',
    requestProfile: 'openai_responses',
    capabilityId: 'ai-sdk:openai-responses',
    surface: 'openai_responses',
    authProfile: 'bearer',
    endpointModelId: 'gpt-5',
    family: 'openai_responses',
    explicitCacheBreakpoints: false,
    systemPrefixRole: 'developer',
  },
  {
    name: 'ChatGPT Codex Responses',
    requestProfile: 'chatgpt_codex_responses',
    capabilityId: 'ai-sdk:openai-responses',
    surface: 'openai_responses',
    authProfile: 'bearer',
    endpointModelId: 'gpt-5.6-sol',
    family: 'chatgpt_codex',
    explicitCacheBreakpoints: false,
  },
  {
    name: 'Anthropic Messages',
    requestProfile: 'anthropic_messages',
    capabilityId: 'ai-sdk:anthropic-messages',
    surface: 'anthropic_messages',
    authProfile: 'api_key',
    endpointModelId: 'claude-fixture',
    family: 'anthropic_messages',
    explicitCacheBreakpoints: true,
  },
  {
    name: 'Google Generative AI',
    requestProfile: 'google_generative_ai',
    capabilityId: 'ai-sdk:google-generative-ai',
    surface: 'google_generative_ai',
    authProfile: 'api_key',
    endpointModelId: 'gemini-3-flash',
    family: 'google_generative_ai',
    explicitCacheBreakpoints: false,
  },
  {
    name: 'DeepSeek Chat',
    requestProfile: 'deepseek_chat',
    capabilityId: 'ai-sdk:deepseek',
    surface: 'openai_chat_completions',
    authProfile: 'bearer',
    endpointModelId: 'deepseek-chat',
    family: 'openai_chat',
    explicitCacheBreakpoints: false,
  },
  {
    name: 'MiniMax Messages',
    requestProfile: 'minimax_chat',
    capabilityId: 'ai-sdk:minimax',
    surface: 'anthropic_messages',
    authProfile: 'api_key',
    endpointModelId: 'MiniMax-M2.5',
    family: 'anthropic_messages',
    explicitCacheBreakpoints: false,
  },
  {
    name: 'Moonshot Chat',
    requestProfile: 'moonshot_chat',
    capabilityId: 'ai-sdk:moonshotai',
    surface: 'openai_chat_completions',
    authProfile: 'bearer',
    endpointModelId: 'kimi-k2',
    family: 'openai_chat',
    explicitCacheBreakpoints: false,
  },
  {
    name: 'Alibaba Chat',
    requestProfile: 'alibaba_chat',
    capabilityId: 'ai-sdk:alibaba',
    surface: 'openai_chat_completions',
    authProfile: 'bearer',
    endpointModelId: 'qwen-max',
    family: 'openai_chat',
    explicitCacheBreakpoints: false,
  },
  {
    name: 'Mistral Chat',
    requestProfile: 'mistral_chat',
    capabilityId: 'ai-sdk:mistral',
    surface: 'openai_chat_completions',
    authProfile: 'bearer',
    endpointModelId: 'mistral-large-latest',
    family: 'openai_chat',
    explicitCacheBreakpoints: false,
  },
  {
    name: 'xAI Responses',
    requestProfile: 'xai_responses',
    capabilityId: 'ai-sdk:xai-responses',
    surface: 'openai_responses',
    authProfile: 'bearer',
    endpointModelId: 'grok-4.1-fast-reasoning',
    family: 'openai_responses',
    explicitCacheBreakpoints: false,
  },
  {
    name: 'Groq Chat',
    requestProfile: 'groq_chat',
    capabilityId: 'ai-sdk:groq',
    surface: 'openai_chat_completions',
    authProfile: 'bearer',
    endpointModelId: 'llama-fixture',
    family: 'openai_chat',
    explicitCacheBreakpoints: false,
  },
  {
    name: 'Cerebras Chat',
    requestProfile: 'cerebras_chat',
    capabilityId: 'ai-sdk:cerebras',
    surface: 'openai_chat_completions',
    authProfile: 'bearer',
    endpointModelId: 'llama-fixture',
    family: 'openai_chat',
    explicitCacheBreakpoints: false,
  },
  {
    name: 'OpenRouter Chat',
    requestProfile: 'openrouter_chat',
    capabilityId: 'ai-sdk:openrouter',
    surface: 'openai_chat_completions',
    authProfile: 'bearer',
    endpointModelId: 'openai/gpt-fixture',
    family: 'openai_chat',
    explicitCacheBreakpoints: false,
  },
  {
    name: 'Fireworks Chat',
    requestProfile: 'fireworks_chat',
    capabilityId: 'ai-sdk:fireworks',
    surface: 'openai_chat_completions',
    authProfile: 'bearer',
    endpointModelId: 'accounts/fireworks/models/fixture',
    family: 'openai_chat',
    explicitCacheBreakpoints: false,
  },
  {
    name: 'Together AI Chat',
    requestProfile: 'togetherai_chat',
    capabilityId: 'ai-sdk:togetherai',
    surface: 'openai_chat_completions',
    authProfile: 'bearer',
    endpointModelId: 'meta-llama/fixture',
    family: 'openai_chat',
    explicitCacheBreakpoints: false,
  },
  {
    name: 'DeepInfra Chat',
    requestProfile: 'deepinfra_chat',
    capabilityId: 'ai-sdk:deepinfra',
    surface: 'openai_chat_completions',
    authProfile: 'bearer',
    endpointModelId: 'meta-llama/fixture',
    family: 'openai_chat',
    explicitCacheBreakpoints: false,
  },
  {
    name: 'Cohere Chat',
    requestProfile: 'cohere_chat',
    capabilityId: 'ai-sdk:cohere',
    surface: 'cohere_chat',
    authProfile: 'bearer',
    endpointModelId: 'command-a-reasoning-08-2025',
    family: 'cohere_chat',
    explicitCacheBreakpoints: false,
  },
  {
    name: 'Z.AI Chat',
    requestProfile: 'zai_chat',
    capabilityId: 'ai-sdk:zai',
    surface: 'openai_chat_completions',
    authProfile: 'bearer',
    endpointModelId: 'glm-5.3',
    family: 'zai_chat',
    explicitCacheBreakpoints: false,
  },
];

function request(modelId: string): CanonicalInferenceRequest {
  return {
    model_id: modelId,
    messages: [
      { role: 'system', content: 'ROOT_SYSTEM' },
      { role: 'system', content: 'HISTORY_SUMMARY' },
      { role: 'user', content: [{ type: 'text', text: 'CURRENT_GOAL' }] },
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool_call',
            call: { id: 'history-call-1', name: 'history_read', arguments: { path: '/fixture' } },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'history-call-1',
        content: [
          {
            type: 'text',
            text: 'HISTORY_TOOL_RESULT',
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '<system-reminder>\nCONTEXT_COMPACTION\n</system-reminder>',
          },
        ],
      },
    ],
    tools: [
      {
        name: 'ordered_first_tool',
        description: '第一个工具',
        parameters: {
          type: 'object',
          properties: { value: { type: 'string', description: '第一个工具输入' } },
          required: ['value'],
          additionalProperties: false,
        },
      },
      {
        name: 'ordered_second_tool',
        description: '第二个工具',
        parameters: {
          type: 'object',
          properties: { value: { type: 'string', description: '第二个工具输入' } },
          required: ['value'],
          additionalProperties: false,
        },
      },
    ],
    tool_choice: 'none',
    cache_policy: {
      breakpoints: [
        { anchor: 'end_of_system_prompt', message_index: 0 },
        { anchor: 'end_of_history_summary', message_index: 1 },
      ],
    },
    sampling: { max_output_tokens: 8_192 },
    invocation: { trace_id: 'trace-compaction', attempt_id: 'attempt-compaction' },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} 必须是对象。`);
  }
  return value;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组。`);
  return value;
}

function expectOrderedMarkers(value: unknown, markers: readonly string[]): void {
  const serialized = JSON.stringify(value);
  let previousIndex = -1;
  for (const marker of markers) {
    const index = serialized.indexOf(marker);
    expect(index, `请求缺少 ${marker}`).toBeGreaterThan(previousIndex);
    previousIndex = index;
  }
}

function expectOrderedTools(value: unknown): void {
  expectOrderedMarkers(value, ['ordered_first_tool', 'ordered_second_tool']);
}

function expectOriginalSystemPrefix(
  value: unknown,
  label: string,
  systemRole: 'system' | 'developer' = 'system'
): void {
  const messages = requireArray(value, label);
  expect(messages).toHaveLength(6);
  expect(
    messages
      .slice(0, 3)
      .map((message, index) => requireRecord(message, `${label}[${index}]`)['role'])
  ).toEqual([systemRole, systemRole, 'user']);
  expect(requireRecord(messages[5], `${label}[5]`)['role']).toBe('user');
}

function expectExplicitCacheBreakpoints(body: Record<string, unknown>, expected: boolean): void {
  const serialized = JSON.stringify(body);
  const matches = serialized.match(/cache_control|prompt_cache_breakpoint/g) ?? [];
  expect(matches.length).toBe(expected ? 2 : 0);
}

function assertWireBody(testCase: CompactionCodecCase, body: Record<string, unknown>): void {
  expectExplicitCacheBreakpoints(body, testCase.explicitCacheBreakpoints);

  switch (testCase.family) {
    case 'openai_chat': {
      const messages = requireArray(body['messages'], `${testCase.name}.messages`);
      expectOriginalSystemPrefix(messages, `${testCase.name}.messages`);
      expectOrderedMarkers(messages, [
        'ROOT_SYSTEM',
        'HISTORY_SUMMARY',
        'CURRENT_GOAL',
        'HISTORY_TOOL_RESULT',
        'CONTEXT_COMPACTION',
      ]);
      expectOrderedTools(body['tools']);
      expect(body['tool_choice']).toBe('none');
      return;
    }
    case 'zai_chat': {
      const messages = requireArray(body['messages'], `${testCase.name}.messages`);
      expectOriginalSystemPrefix(messages, `${testCase.name}.messages`);
      expectOrderedMarkers(messages, [
        'ROOT_SYSTEM',
        'HISTORY_SUMMARY',
        'CURRENT_GOAL',
        'HISTORY_TOOL_RESULT',
        'CONTEXT_COMPACTION',
      ]);
      // Z.AI 当前只支持自动工具选择；官方 package 会把 canonical tools + none
      // 严格投影为完全不发送工具，避免服务端把禁用状态解释成可调用。
      expect(body['tools']).toBeUndefined();
      expect(body['tool_choice']).toBeUndefined();
      return;
    }
    case 'openai_responses': {
      const input = requireArray(body['input'], `${testCase.name}.input`);
      expectOriginalSystemPrefix(input, `${testCase.name}.input`, testCase.systemPrefixRole);
      expectOrderedMarkers(input, [
        'ROOT_SYSTEM',
        'HISTORY_SUMMARY',
        'CURRENT_GOAL',
        'HISTORY_TOOL_RESULT',
        'CONTEXT_COMPACTION',
      ]);
      expectOrderedTools(body['tools']);
      expect(body['tool_choice']).toBe('none');
      return;
    }
    case 'chatgpt_codex': {
      expect(body['instructions']).toBe('ROOT_SYSTEM\n\nHISTORY_SUMMARY');
      const input = requireArray(body['input'], `${testCase.name}.input`);
      expect(JSON.stringify(input)).not.toMatch(/ROOT_SYSTEM|HISTORY_SUMMARY/);
      expectOrderedMarkers(input, ['CURRENT_GOAL', 'HISTORY_TOOL_RESULT', 'CONTEXT_COMPACTION']);
      expectOrderedTools(body['tools']);
      expect(body['tool_choice']).toBe('none');
      expect(body).not.toHaveProperty('max_output_tokens');
      return;
    }
    case 'anthropic_messages': {
      expectOrderedMarkers(body['system'], ['ROOT_SYSTEM', 'HISTORY_SUMMARY']);
      expectOrderedMarkers(body['messages'], [
        'CURRENT_GOAL',
        'HISTORY_TOOL_RESULT',
        'CONTEXT_COMPACTION',
      ]);
      // Anthropic 协议没有 none；官方 codec 通过删除工具实现同一安全语义。
      expect(body).not.toHaveProperty('tools');
      expect(body).not.toHaveProperty('tool_choice');
      return;
    }
    case 'google_generative_ai': {
      expectOrderedMarkers(body['systemInstruction'], ['ROOT_SYSTEM', 'HISTORY_SUMMARY']);
      expectOrderedMarkers(body['contents'], [
        'CURRENT_GOAL',
        'HISTORY_TOOL_RESULT',
        'CONTEXT_COMPACTION',
      ]);
      expectOrderedTools(body['tools']);
      expect(body['toolConfig']).toEqual({ functionCallingConfig: { mode: 'NONE' } });
      return;
    }
    case 'cohere_chat': {
      const messages = requireArray(body['messages'], `${testCase.name}.messages`);
      expectOriginalSystemPrefix(messages, `${testCase.name}.messages`);
      expectOrderedMarkers(messages, [
        'ROOT_SYSTEM',
        'HISTORY_SUMMARY',
        'CURRENT_GOAL',
        'HISTORY_TOOL_RESULT',
        'CONTEXT_COMPACTION',
      ]);
      expectOrderedTools(body['tools']);
      expect(body['tool_choice']).toBe('NONE');
    }
  }
}

async function collect(
  stream: AsyncIterable<CanonicalInferenceEvent>
): Promise<CanonicalInferenceEvent[]> {
  const events: CanonicalInferenceEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('Context compaction canonical request codec conformance', () => {
  it.each(CASES)(
    '$name 保留完整前缀并接纳末尾 Reminder / tools+none / cache policy',
    async testCase => {
      let fetchCount = 0;
      let capturedBody: unknown;
      const fixtureFetch: typeof fetch = async (_input, init) => {
        fetchCount += 1;
        if (typeof init?.body === 'string') {
          const parsed: unknown = JSON.parse(init.body);
          capturedBody = parsed;
        }
        return new Response(JSON.stringify({ error: { message: 'fixture stop' } }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      };
      const route: AiSdkInferenceRoute = {
        model_id: `model-${testCase.requestProfile}`,
        request_profile: testCase.requestProfile,
        capability_id: testCase.capabilityId,
        endpoint_id: `fixture-${testCase.requestProfile}`,
        endpoint_model_id: testCase.endpointModelId,
        surface: testCase.surface,
        base_url: 'https://fixture.invalid/v1',
        ...(testCase.family === 'chatgpt_codex'
          ? { headers: { 'chatgpt-account-id': 'account-fixture' } }
          : {}),
      };
      const capability = createAiSdkInferenceCapability(route.capability_id, route.surface, {
        language_models: createAiSdkLanguageModelRegistry(fixtureFetch),
      });
      const credential =
        testCase.authProfile === 'none'
          ? undefined
          : { profile: testCase.authProfile, secret: 'fixture-secret' };

      const events = await collect(
        capability.stream({
          request: request(route.model_id),
          route,
          ...(credential ? { credential } : {}),
        })
      );

      expect(fetchCount).toBe(1);
      expect(events.at(-1)).toEqual(expect.objectContaining({ type: 'failure' }));
      assertWireBody(testCase, requireRecord(capturedBody, `${testCase.name}.body`));
    }
  );
});
