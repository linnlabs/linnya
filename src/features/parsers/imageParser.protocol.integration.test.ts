import { createServer } from 'node:http';
import sharp from 'sharp';
import { GifEncoder } from '@napi-rs/canvas';
import { z } from 'zod';
import { expect, it, vi } from 'vitest';
import { createAiSdkInferenceCapability, createAiSdkLanguageModelRegistry, type AiSdkInferenceRoute } from '@linnlabs/linnkit-provider-ai-sdk';
import { createTextGenerationPort } from '../../app-hosts/linnya/adapters/inference/orchestration/createTextGenerationPort';
import { detectSupportedImageMediaType } from '../../shared/media/image-inspection';
import type { TextGenerationPort } from '@linnya/plugin-host-contract/backend/inferenceRuntime';
import { createStaticBmp } from './testkit/createStaticBmp';
import { createAnimatedPng } from './testkit/createAnimatedPng';
import { parseImageWithAi } from './imageParser';

const WireBody = z.object({
  model: z.string(), stream: z.literal(true),
  messages: z.array(z.object({
    content: z.union([z.string(), z.array(z.object({
      type: z.string(), image_url: z.object({ url: z.string() }).optional(),
    }))]),
  })),
});

/** OpenAI 官方 Chat Completions image_url / SSE 格式，只模拟本机合成服务。 */
async function fixture() {
  const received: Array<{ mediaType: string; bytes: Buffer }> = [];
  let count = 0;
  const server = createServer(async (request, response) => {
    count += 1;
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    try {
      if (request.url !== '/v1/chat/completions' || request.method !== 'POST') throw new Error('Wrong endpoint');
      if (request.headers.authorization !== 'Bearer fixture-secret') throw new Error('Wrong auth');
      if (!request.headers['content-type']?.includes('application/json')) throw new Error('Wrong content type');
      const payload = WireBody.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (payload.model !== 'fixture-vision') throw new Error('Wrong model');
      const images = payload.messages.flatMap(message => typeof message.content === 'string' ? [] : message.content).filter(block => block.type === 'image_url');
      if (images.length !== 1) throw new Error('Wrong image count');
      const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(images[0]?.image_url?.url ?? '');
      if (!match) throw new Error('Wrong data URL');
      const bytes = Buffer.from(match[2], 'base64');
      if (detectSupportedImageMediaType(bytes) !== match[1]) throw new Error('MIME differs from actual bytes');
      await sharp(bytes).stats();
      received.push({ mediaType: match[1], bytes });
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const choice of [{ delta: { content: '合成图片描述' }, finish_reason: null }, { delta: {}, finish_reason: 'stop' }]) {
        response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture-vision', choices: [{ index: 0, ...choice }] })}\n\n`);
      }
      response.end('data: [DONE]\n\n');
    } catch (error) {
      response.writeHead(422, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } }));
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server address');
  const route: AiSdkInferenceRoute = {
    model_id: 'local-vision', request_profile: 'openai_chat', capability_id: 'ai-sdk:openai-chat',
    endpoint_id: 'local', endpoint_model_id: 'fixture-vision', surface: 'openai_chat_completions',
    base_url: `http://127.0.0.1:${address.port}/v1`, headers: {},
  };
  const capability = createAiSdkInferenceCapability(route.capability_id, route.surface, { language_models: createAiSdkLanguageModelRegistry() });
  const port = createTextGenerationPort({ inferencePort: {
    stream: request => capability.stream({ request, route, credential: { profile: 'bearer', secret: 'fixture-secret' } }),
  } });
  return { port, received, count: () => count, close: async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  } };
}

function animatedGif(): Buffer {
  const encoder = new GifEncoder(2, 1, { repeat: 0 });
  encoder.addFrame(new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0]), 2, 1, { delay: 100 });
  encoder.addFrame(new Uint8Array([0, 255, 0, 255, 0, 0, 0, 0]), 2, 1, { delay: 100 });
  return encoder.finish();
}

it('真实PNG/JPEG/WebP及静态GIF/BMP经Parser→Host→官方SDK→HTTP保持字节和MIME一致', async () => {
  const pixels = Buffer.from([255, 0, 0, 255, 0, 0, 0, 0]);
  const source = sharp(pixels, { raw: { width: 2, height: 1, channels: 4 } });
  const cases = [
    { format: 'png', bytes: await source.clone().png().toBuffer(), expected: 'image/png', unchanged: true },
    { format: 'jpeg', bytes: await source.clone().jpeg().toBuffer(), expected: 'image/jpeg', unchanged: true },
    { format: 'webp', bytes: await source.clone().webp().toBuffer(), expected: 'image/webp', unchanged: true },
    { format: 'gif', bytes: await source.clone().gif().toBuffer(), expected: 'image/png', unchanged: false },
    { format: 'bmp', bytes: createStaticBmp(), expected: 'image/png', unchanged: false },
  ];
  const server = await fixture();
  try {
    for (const sample of cases) {
      const blocks = await parseImageWithAi(sample.bytes, sample.format, server.port, 'local-vision', undefined, AbortSignal.timeout(3000));
      expect(blocks[0]?.text).toBe('合成图片描述');
      const request = server.received[server.received.length - 1];
      expect(request?.mediaType).toBe(sample.expected);
      if (!request) throw new Error('Missing image request');
      if (sample.unchanged) expect(request.bytes).toEqual(sample.bytes);
      if (sample.format === 'gif') {
        const { data } = await sharp(request.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        expect(data[7]).toBe(0);
      }
    }
    expect(server.count()).toBe(5);
  } finally { await server.close(); }
});

it('动图及无效输入在模型调用前明确拒绝，不默取首帧或重试', async () => {
  const gif = animatedGif();
  const webp = await sharp(gif, { animated: true }).webp().toBuffer();
  const generate = vi.fn<TextGenerationPort['generate']>();
  const apng = createAnimatedPng();
  // 有效 PNG 默认帧可真实解码；额外动画 chunk 不应被当作静态图悄悄交给模型。
  expect((await sharp(apng).metadata()).width).toBe(1);
  await sharp(apng).stats();
  for (const bytes of [gif, webp, apng]) {
    await expect(parseImageWithAi(bytes, 'animated', { generate }, 'vision')).rejects.toThrow('请先转换为静态图片');
  }
  await expect(parseImageWithAi(new Uint8Array([1]), 'broken', { generate }, 'vision')).rejects.toThrow('无法识别图片格式');
  expect(generate).not.toHaveBeenCalled();
});
