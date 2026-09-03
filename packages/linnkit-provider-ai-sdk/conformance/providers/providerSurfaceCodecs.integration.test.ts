import { describe, expect, it } from 'vitest';
import {
  createAiSdkInferenceCapability,
  createAiSdkLanguageModelRegistry,
} from '@linnlabs/linnkit-provider-ai-sdk';
import {
  collectProviderSurfaceEvents as collect,
  providerSurfaceInvocation as invocation,
  providerSurfaceRoute as route,
  providerSurfaceToolImageInvocation as toolImageInvocation,
} from '../fixtures/providerSurfaceCodecFixture';

describe('AI SDK official Provider surface conformance', () => {
  it.each([
    {
      capabilityId: 'ai-sdk:openai-compatible',
      surface: 'openai_chat_completions',
      modelId: 'glm-5.3',
      path: '/chat/completions',
    },
    {
      capabilityId: 'ai-sdk:openai-responses',
      surface: 'openai_responses',
      modelId: 'gpt-5.6-luna',
      path: '/responses',
    },
    {
      capabilityId: 'ai-sdk:anthropic-messages',
      surface: 'anthropic_messages',
      modelId: 'qwen3.8-max',
      path: '/messages',
    },
  ] as const)(
    'OpenCode Go 的 $modelId 通过正式 $surface codec 与共享 Bearer 凭据发起请求',
    async ({ capabilityId, surface, modelId, path }) => {
      const resolvedRoute = {
        ...route(capabilityId, surface, 'bearer'),
        base_url: 'https://opencode.ai/zen/go/v1',
        endpoint_model_id: modelId,
      };
      let requestUrl = '';
      let requestHeaders = new Headers();
      const fixtureFetch: typeof fetch = async (input, init) => {
        requestUrl = String(input);
        requestHeaders = new Headers(init?.headers);
        return new Response(JSON.stringify({ error: { message: 'fixture stop' } }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      };
      const capability = createAiSdkInferenceCapability(capabilityId, surface, {
        language_models: createAiSdkLanguageModelRegistry(fixtureFetch),
      });

      await collect(capability.stream(invocation(resolvedRoute)));

      expect(requestUrl).toBe(`https://opencode.ai/zen/go/v1${path}`);
      expect(requestHeaders.get('authorization')).toBe('Bearer fixture-secret');
      expect(requestHeaders.get('x-api-key')).toBeNull();
    },
  );

  it('Responses、Anthropic 与 Google 原生 codec 保留工具图片角色', async () => {
    const routes = [
      route('ai-sdk:openai-responses', 'openai_responses', 'bearer'),
      route('ai-sdk:anthropic-messages', 'anthropic_messages', 'api_key'),
      route('ai-sdk:google-generative-ai', 'google_generative_ai', 'api_key'),
    ] as const;
    const bodies: unknown[] = [];

    for (const resolvedRoute of routes) {
      const fixtureFetch: typeof fetch = async (_input, init) => {
        bodies.push(typeof init?.body === 'string' ? JSON.parse(init.body) : undefined);
        return new Response(JSON.stringify({ error: { message: 'fixture stop' } }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      };
      const capability = createAiSdkInferenceCapability(
        resolvedRoute.capability_id,
        resolvedRoute.surface,
        { language_models: createAiSdkLanguageModelRegistry(fixtureFetch) },
      );
      await collect(capability.stream(toolImageInvocation(resolvedRoute)));
    }

    expect(bodies[0]).toMatchObject({
      input: [
        { role: 'user' },
        { type: 'function_call', call_id: 'call-image' },
        {
          type: 'function_call_output',
          call_id: 'call-image',
          output: [
            { type: 'input_text', text: '图片读取成功' },
            { type: 'input_image', image_url: 'data:image/png;base64,AQID' },
          ],
        },
      ],
    });
    expect(bodies[1]).toMatchObject({
      messages: [
        { role: 'user' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'call-image' }] },
        {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: 'call-image',
            content: [
              { type: 'text', text: '图片读取成功' },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AQID' } },
            ],
          }],
        },
      ],
    });
    expect(bodies[2]).toMatchObject({
      contents: [
        { role: 'user' },
        { role: 'model', parts: [{ functionCall: { name: 'read_file' } }] },
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                id: 'call-image',
                name: 'read_file',
                response: { name: 'read_file', content: '图片读取成功' },
              },
            },
            { inlineData: { mimeType: 'image/png', data: 'AQID' } },
            { text: 'Tool executed successfully and returned this image as a response' },
          ],
        },
      ],
    });
  });
});
