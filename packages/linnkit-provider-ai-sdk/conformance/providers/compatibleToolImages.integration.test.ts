import { describe, expect, it, vi } from 'vitest';
import {
  createAiSdkInferenceCapability,
  createAiSdkLanguageModelRegistry,
} from '@linnlabs/linnkit-provider-ai-sdk';
import { route, runToolRoundTrip } from '../fixtures/dedicatedProviderCodecFixture';

const compatibleRoute = route({
  capabilityId: 'ai-sdk:openai-compatible',
  surface: 'openai_chat_completions',
  authProfile: 'bearer',
  providerModelId: 'verified-vision-model',
});
const firstResponse = [
  { choices: [{ delta: { tool_calls: [{
    index: 0, id: 'image-call',
    function: { name: 'read_file', arguments: '{"path":"/fixture/image.png"}' },
  }] } }] },
  { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
];
const secondResponse = [
  { choices: [{ delta: { role: 'assistant', content: '已比较图片。' } }] },
  { choices: [{ delta: {}, finish_reason: 'stop' }] },
];

describe('compatible 上游 multipart tool opt-in', () => {
  it('已准入 route 两轮保留用户图片、工具文本/图片顺序与 call 配对，每轮只发一个请求', async () => {
    const result = await runToolRoundTrip({
      resolvedRoute: { ...compatibleRoute, tool_result_image: true },
      firstResponse,
      secondResponse,
      initialMessages: [{ role: 'user', content: [
        { type: 'text', text: '读取工具图片并与用户图片比较。' },
        { type: 'image', media_type: 'image/png', bytes: Uint8Array.of(1, 2, 3) },
      ] }],
      toolResultContent: [
        { type: 'text', text: '已读取两张图片。' },
        { type: 'image', media_type: 'image/png', bytes: Uint8Array.of(4, 5, 6) },
        { type: 'image', media_type: 'image/jpeg', bytes: Uint8Array.of(7, 8, 9) },
      ],
    });
    expect(result.requests).toHaveLength(2);
    expect(result.requests[1]?.headers.get('authorization')).toBe('Bearer fixture-secret');
    expect(result.requests[1]?.body).toMatchObject({ messages: [
      { role: 'user', content: [
        { type: 'text', text: '读取工具图片并与用户图片比较。' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
      ] },
      { role: 'assistant', tool_calls: [{ id: 'image-call', type: 'function', function: {
        name: 'read_file', arguments: '{"path":"/fixture/image.png"}',
      } }] },
      { role: 'tool', tool_call_id: 'image-call', content: [
        { type: 'text', text: '已读取两张图片。' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,BAUG' } },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,BwgJ' } },
      ] },
    ] });
    expect(result.firstEvents.at(-1)).toEqual({ type: 'finish', reason: 'tool_use' });
    expect(result.secondEvents.at(-1)).toEqual({ type: 'finish', reason: 'stop' });
  });

  it.each([undefined, true] as const)('文本工具 wire 在 opt-in=%s 时仍为普通字符串', async toolResultImage => {
    const result = await runToolRoundTrip({
      resolvedRoute: { ...compatibleRoute, ...(toolResultImage ? { tool_result_image: toolResultImage } : {}) },
      firstResponse,
      secondResponse,
    });
    expect(result.requests).toHaveLength(2);
    expect(result.requests[1]?.body).toMatchObject({ messages: [
      { role: 'user', content: '读取文件' },
      { role: 'assistant', tool_calls: [{ id: 'image-call' }] },
      { role: 'tool', tool_call_id: 'image-call', content: 'file contents' },
    ] });
  });

  it('已准入图片 route 遇到 503 仍为零 SDK retry、单 fetch', async () => {
    const fixtureFetch = vi.fn<typeof fetch>(async () => new Response('{}', {
      status: 503, headers: { 'content-type': 'application/json' },
    }));
    const capability = createAiSdkInferenceCapability(compatibleRoute.capability_id, compatibleRoute.surface, {
      language_models: createAiSdkLanguageModelRegistry(fixtureFetch),
    });
    const events = [];
    for await (const event of capability.stream({
      route: { ...compatibleRoute, tool_result_image: true },
      credential: { profile: 'bearer', secret: 'fixture-secret' },
      request: {
        model_id: compatibleRoute.model_id,
        messages: [
          { role: 'assistant', parts: [{ type: 'tool_call', call: { id: 'image-call', name: 'read_file', arguments: {} } }] },
          { role: 'tool', tool_call_id: 'image-call', content: [
            { type: 'image', media_type: 'image/png', bytes: Uint8Array.of(1, 2, 3) },
          ] },
        ],
        tools: [], tool_choice: 'none', sampling: {},
        invocation: { trace_id: 'image-failure', attempt_id: 'image-failure-1' },
      },
    })) events.push(event);
    expect(fixtureFetch).toHaveBeenCalledOnce();
    expect(events.at(-1)).toMatchObject({ type: 'failure', code: 'provider_http_503', retryable: true });
  });
});
