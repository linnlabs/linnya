import { describe, expect, it, vi } from 'vitest';
import { createDeepSeek } from '@ai-sdk/deepseek';
import type { LanguageModelV4Prompt } from '@ai-sdk/provider';

import { route, runToolRoundTrip } from '../fixtures/dedicatedProviderCodecFixture';

describe('dedicated Provider package codec conformance', () => {
  it.each(['user', 'tool'] as const)('SDK 的 %s 非法图片格式在发送前拒绝，不降级成文本', async role => {
    const fixtureFetch = vi.fn<typeof fetch>();
    const model = createDeepSeek({
      apiKey: 'fixture-secret',
      baseURL: 'https://fixture.invalid/v1',
      fetch: fixtureFetch,
    }).chat('deepseek-flash');
    // Canonical 合同只允许已准入的三种 raster 图片；非法格式应在 SDK 的公开边界测试，
    // 不能靠扩大 canonical 类型或断言伪造一份永远进不了 Host 的输入。
    const invalidImage = {
      type: 'file' as const,
      mediaType: 'image/svg+xml',
      data: { type: 'data' as const, data: new TextEncoder().encode('<svg/>') },
    };
    const prompt: LanguageModelV4Prompt = role === 'user'
      ? [{ role: 'user', content: [invalidImage] }]
      : [
          { role: 'user', content: [{ type: 'text', text: '读取图片。' }] },
          { role: 'assistant', content: [{
            type: 'tool-call', toolCallId: 'image-call', toolName: 'read_file', input: {},
          }] },
          { role: 'tool', content: [{
            type: 'tool-result', toolCallId: 'image-call', toolName: 'read_file',
            output: { type: 'content', value: [invalidImage] },
          }] },
        ];
    await expect(model.doGenerate({ prompt })).rejects.toThrow(
      'DeepSeek supports JPEG, PNG, GIF, and WebP image inputs.',
    );
    expect(fixtureFetch).not.toHaveBeenCalled();
  });

  it.each(['deepseek-flash', 'deepseek-v4-flash-vision-exp'])(
    '%s 保留前轮 reasoning、用户图片和工具原生图片，空 tool delta 不截断推理',
    async modelId => {
      const resolvedRoute = route({
        capabilityId: 'ai-sdk:deepseek',
        surface: 'openai_chat_completions',
        authProfile: 'bearer',
        providerModelId: modelId,
      });
      const result = await runToolRoundTrip({
        resolvedRoute,
        initialMessages: [
          { role: 'user', content: [{ type: 'text', text: '先检查数据来源。' }] },
          {
            role: 'assistant',
            parts: [
              { type: 'reasoning', text: '来源已核对，接下来比较图表。' },
              { type: 'text', text: '请提供图表。' },
            ],
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: '读取导出图并与这张图比较。' },
              { type: 'image', media_type: 'image/png', bytes: Uint8Array.from([1, 2, 3]) },
            ],
          },
        ],
        firstResponse: [
          { choices: [{ delta: { role: 'assistant', reasoning_content: '先读取' } }] },
          // 上游可能在推理中发送空数组；它不表示一个工具或 assistant part 已结束。
          { choices: [{ delta: { tool_calls: [] } }] },
          { choices: [{ delta: { reasoning_content: '图表。' } }] },
          {
            choices: [{ delta: { tool_calls: [{
              index: 0,
              id: 'chart-call',
              function: { name: 'read_file', arguments: '{"path":"/fixture/chart.png"}' },
            }] } }],
          },
          {
            choices: [{ delta: {}, finish_reason: 'tool_calls' }],
            usage: { prompt_tokens: 24, completion_tokens: 8, total_tokens: 32 },
          },
        ],
        toolResultContent: [
          { type: 'text', text: '导出图已读取。' },
          { type: 'image', media_type: 'image/png', bytes: Uint8Array.from([4, 5, 6]) },
        ],
        secondResponse: [
          { choices: [{ delta: { role: 'assistant', content: '已对照两张图。' } }] },
          {
            choices: [{ delta: {}, finish_reason: 'stop' }],
            usage: { prompt_tokens: 33, completion_tokens: 4, total_tokens: 37 },
          },
        ],
      });

      expect(result.requests).toHaveLength(2);
      expect(result.replay).toEqual([
        { type: 'reasoning', text: '先读取图表。' },
        { type: 'tool_call', call: {
          id: 'chart-call', name: 'read_file', arguments: { path: '/fixture/chart.png' },
        } },
      ]);
      expect(result.requests[1]?.body).toMatchObject({
        model: modelId,
        messages: [
          { role: 'user', content: '先检查数据来源。' },
          {
            role: 'assistant',
            reasoning_content: '来源已核对，接下来比较图表。',
            content: '请提供图表。',
          },
          { role: 'user', content: [
            { type: 'text', text: '读取导出图并与这张图比较。' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
          ] },
          { role: 'assistant', reasoning_content: '先读取图表。' },
          { role: 'tool', tool_call_id: 'chart-call', content: [
            { type: 'text', text: '导出图已读取。' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,BAUG' } },
          ] },
        ],
      });
      expect(result.firstEvents).toContainEqual(expect.objectContaining({ type: 'usage' }));
      expect(result.secondEvents).toContainEqual(expect.objectContaining({ type: 'usage' }));
      expect(result.secondEvents.at(-1)).toEqual({ type: 'finish', reason: 'stop' });
    },
  );

  it('DeepSeek V4 由官方 codec 完成 reasoning、工具调用、usage 与第二轮回放', async () => {
    const resolvedRoute = route({
      capabilityId: 'ai-sdk:deepseek',
      surface: 'openai_chat_completions',
      authProfile: 'bearer',
      providerModelId: 'deepseek-v4-pro',
    });
    const result = await runToolRoundTrip({
      resolvedRoute,
      firstResponse: [
        {
          id: 'response-1',
          created: 1,
          model: resolvedRoute.endpoint_model_id,
          choices: [
            {
              delta: { role: 'assistant', reasoning_content: '先读取文件。' },
              finish_reason: null,
            },
          ],
        },
        {
          id: 'response-1',
          created: 1,
          model: resolvedRoute.endpoint_model_id,
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call-1',
                    function: { name: 'read_file', arguments: '{"path":"/tmp/a"}' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        {
          id: 'response-1',
          created: 1,
          model: resolvedRoute.endpoint_model_id,
          choices: [{ delta: {}, finish_reason: 'tool_calls' }],
          usage: {
            prompt_tokens: 17,
            completion_tokens: 6,
            prompt_cache_hit_tokens: 4,
            prompt_cache_miss_tokens: 13,
            total_tokens: 23,
            completion_tokens_details: { reasoning_tokens: 2 },
          },
        },
      ],
      secondResponse: [
        {
          id: 'response-2',
          created: 2,
          model: resolvedRoute.endpoint_model_id,
          choices: [{ delta: { role: 'assistant', content: '读取完成。' }, finish_reason: null }],
        },
        {
          id: 'response-2',
          created: 2,
          model: resolvedRoute.endpoint_model_id,
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 24, completion_tokens: 3, total_tokens: 27 },
        },
      ],
    });

    expect(result.requests).toHaveLength(2);
    expect(result.requests[0]?.url).toBe('https://fixture.invalid/v1/chat/completions');
    expect(result.requests[0]?.headers.get('authorization')).toBe('Bearer fixture-secret');
    expect(result.requests[0]?.body).toMatchObject({
      model: 'deepseek-v4-pro',
      stream: true,
      tools: [{ type: 'function', function: { name: 'read_file' } }],
    });
    expect(result.requests[0]?.body).toHaveProperty('tool_choice', 'auto');
    expect(result.firstEvents).toEqual(
      expect.arrayContaining([
        { type: 'thought_delta', text: '先读取文件。' },
        {
          type: 'assistant_part_end',
          index: 0,
          part: { type: 'reasoning', text: '先读取文件。' },
        },
        {
          type: 'tool_call_end',
          index: 0,
          call: { id: 'call-1', name: 'read_file', arguments: { path: '/tmp/a' } },
        },
        {
          type: 'usage',
          usage: {
            inputTokens: 13,
            outputTokens: 6,
            cacheReadTokens: 4,
            reasoningTokens: 2,
            source: 'provider-response-usage',
            confidence: 'actual',
            rawUsage: {
              prompt_tokens: 17,
              completion_tokens: 6,
              prompt_cache_hit_tokens: 4,
              prompt_cache_miss_tokens: 13,
              total_tokens: 23,
              completion_tokens_details: { reasoning_tokens: 2 },
            },
          },
        },
        { type: 'finish', reason: 'tool_use' },
      ])
    );
    expect(result.requests[1]?.body).toMatchObject({
      messages: [
        { role: 'user', content: '读取文件' },
        {
          role: 'assistant',
          content: '',
          reasoning_content: '先读取文件。',
          tool_calls: [
            {
              type: 'function',
              id: 'call-1',
              function: { name: 'read_file', arguments: '{"path":"/tmp/a"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call-1', content: 'file contents' },
      ],
    });
    expect(result.requests[1]?.body).toHaveProperty('tool_choice', 'auto');
    expect(result.secondEvents[result.secondEvents.length - 1]).toEqual({
      type: 'finish',
      reason: 'stop',
    });
  });
});
