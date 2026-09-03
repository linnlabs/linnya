import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { QwenASRAdapter } from './qwen-asr-adapter';

const RequestBodySchema = z.object({
  model: z.string(),
  input: z.object({
    messages: z.array(z.object({
      role: z.string(),
      content: z.array(z.record(z.string(), z.string())),
    })),
  }),
  parameters: z.object({
    asr_options: z.record(z.string(), z.union([z.string(), z.boolean()])),
  }),
});

describe('QwenASRAdapter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends one documented DashScope request with system context before audio', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      choices: [{
        message: {
          content: '产品评审完成。',
          annotations: [{ type: 'audio_info', language: 'zh' }],
        },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new QwenASRAdapter({
      id: 'qwen-asr',
      credential: 'secret',
      route: {
        api_surface: 'dashscope_multimodal_generation',
        capability_id: 'host:dashscope-qwen-asr',
        endpoint_id: 'dashscope',
        endpoint_model_id: 'qwen3-asr-flash',
        base_url: 'https://dashscope.aliyuncs.com/api/v1',
        auth_profile: 'bearer',
      },
    });

    await expect(adapter.transcribe(new Uint8Array([1, 2, 3]), 'meeting.webm', {
      language: 'zh',
      prompt: 'Linnya 产品评审',
    })).resolves.toEqual({ text: '产品评审完成。', language: 'zh' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
    const rawRequest: unknown = JSON.parse(String(init?.body));
    const request = RequestBodySchema.parse(rawRequest);
    expect(request.input.messages.map(message => message.role)).toEqual(['system', 'user']);
    expect(request.input.messages[1].content[0].audio).toBe('data:audio/webm;base64,AQID');
    expect(request.parameters.asr_options).toEqual({
      enable_lid: true,
      enable_itn: false,
      language: 'zh',
    });
  });
});
