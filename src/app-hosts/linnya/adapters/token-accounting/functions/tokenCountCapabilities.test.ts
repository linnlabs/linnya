import { describe, expect, it } from 'vitest';
import type { TokenCountCapabilityInput } from '../definitions/tokenCountCapability';
import { ANTHROPIC_TOKEN_COUNT_CAPABILITY } from './anthropicTokenCountCapability';
import { GEMINI_TOKEN_COUNT_CAPABILITY } from './geminiTokenCountCapability';
import { ZAI_TOKEN_COUNT_CAPABILITY } from './zaiTokenCountCapability';

function input(overrides: Partial<TokenCountCapabilityInput> = {}): TokenCountCapabilityInput {
  return {
    route: {
      capabilityId: 'test',
      baseURL: 'https://gateway.example/v1',
      modelId: 'host-model',
      endpointModelId: 'provider-model',
      capabilities: { supportsRemoteTokenCount: true },
    },
    credential: { profile: 'bearer', secret: 'sk-test' },
    baseURL: 'https://gateway.example/v1',
    endpointModelId: 'provider-model',
    messages: [
      { role: 'system', content: 'system rules' },
      { role: 'user', content: 'question' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'lookup', arguments: '{"query":"linnya"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call-1', content: 'result' },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'lookup',
          description: 'Lookup documents',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      },
    ],
    ...overrides,
  };
}

describe('token count provider capabilities', () => {
  it('Anthropic count body 提升 system，并保持 tool_use/tool_result 与工具 schema', () => {
    const request = ANTHROPIC_TOKEN_COUNT_CAPABILITY.buildRequest(
      input({
        credential: { profile: 'api_key', secret: 'sk-test' },
      })
    );

    expect(request.url).toBe('https://gateway.example/v1/messages/count_tokens');
    expect(request.headers).toMatchObject({
      'x-api-key': 'sk-test',
      'anthropic-version': '2023-06-01',
    });
    expect(request.body).toMatchObject({
      model: 'provider-model',
      system: 'system rules',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'question' }] },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'call-1', name: 'lookup', input: { query: 'linnya' } }],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'result' }],
        },
      ],
      tools: [
        {
          name: 'lookup',
          description: 'Lookup documents',
          input_schema: expect.objectContaining({ type: 'object' }),
        },
      ],
    });
    expect(ANTHROPIC_TOKEN_COUNT_CAPABILITY.readInputTokens({ input_tokens: 31 })).toBe(31);
  });

  it('Gemini count body 使用 generateContentRequest 保留 system、工具调用和结果', () => {
    const request = GEMINI_TOKEN_COUNT_CAPABILITY.buildRequest(input());

    expect(request.url).toBe('https://gateway.example/v1/models/provider-model:countTokens');
    expect(request.headers).toMatchObject({ 'x-goog-api-key': 'sk-test' });
    expect(request.body).toMatchObject({
      generateContentRequest: {
        model: 'models/provider-model',
        systemInstruction: { parts: [{ text: 'system rules' }] },
        contents: [
          { role: 'user', parts: [{ text: 'question' }] },
          {
            role: 'model',
            parts: [{ functionCall: { name: 'lookup', args: { query: 'linnya' } } }],
          },
          {
            role: 'user',
            parts: [{ functionResponse: { name: 'lookup', response: { result: 'result' } } }],
          },
        ],
        tools: [{ functionDeclarations: [{ name: 'lookup' }] }],
      },
    });
    expect(GEMINI_TOKEN_COUNT_CAPABILITY.readInputTokens({ totalTokens: 37 })).toBe(37);
  });

  it('Z.AI tokenizer 使用 OpenAI-shaped 工具消息并只读取 usage.total_tokens', () => {
    const request = ZAI_TOKEN_COUNT_CAPABILITY.buildRequest(input());

    expect(request.url).toBe('https://gateway.example/v1/paas/v4/tokenizer');
    expect(request.body).toMatchObject({
      model: 'provider-model',
      messages: [
        { role: 'system', content: 'system rules' },
        { role: 'user', content: 'question' },
        {
          role: 'assistant',
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: { name: 'lookup', arguments: '{"query":"linnya"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call-1', content: 'result' },
      ],
    });
    expect(ZAI_TOKEN_COUNT_CAPABILITY.readInputTokens({ usage: { total_tokens: 41 } })).toBe(41);
    expect(() => ZAI_TOKEN_COUNT_CAPABILITY.readInputTokens({ total_tokens: 41 })).toThrow(/usage/);
  });

  it('图片或 Provider continuation 尚未进入 count codec 时明确拒绝，避免产出偏小估算', () => {
    expect(() =>
      ANTHROPIC_TOKEN_COUNT_CAPABILITY.buildRequest(
        input({
          messages: [
            {
              role: 'user',
              content: 'describe',
              attachments: [
                {
                  kind: 'image',
                  id: 'image-1',
                  resourceId: 'resource-1',
                  mediaType: 'image/png',
                  byteLength: 1,
                  width: 1,
                  height: 1,
                  sha256: 'a'.repeat(64),
                },
              ],
            },
          ],
        })
      )
    ).toThrow(/已物化图片/);

    expect(() =>
      ANTHROPIC_TOKEN_COUNT_CAPABILITY.buildRequest(
        input({
          messages: [
            {
              role: 'assistant',
              content: 'answer',
              assistant_replay_parts: [{ type: 'text', text: 'answer' }],
            },
          ],
        })
      )
    ).toThrow(/Provider continuation/);
  });
});
