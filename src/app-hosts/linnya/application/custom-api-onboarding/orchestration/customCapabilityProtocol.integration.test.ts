import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  CustomCapabilityModelCommandSchema,
  type CustomCapabilityApiFormat,
} from '@app/schemas/custom-api-onboarding';
import { testCustomCapabilityModel } from './testCustomCapabilityModel';
import { startCustomCapabilityProtocolServer } from '../__tests__/fixtures/customCapabilityProtocolServer';
import {
  createAiSdkInferenceCapability,
  createAiSdkLanguageModelRegistry,
  type AiSdkInferenceRoute,
} from '@linnlabs/linnkit-provider-ai-sdk';
import { createTextGenerationPort } from '../../../adapters/inference/orchestration/createTextGenerationPort';
import { createRerankingPort } from '../../../adapters/inference/orchestration/createRerankingPort';
import { buildCustomCapabilityRegistration } from '../functions/buildCustomCapabilityRegistration';
import { MODEL_CONNECTION_TEST_PNG } from '../definitions/modelConnectionTestDocument';

const servers: Awaited<ReturnType<typeof startCustomCapabilityProtocolServer>>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()));
});

async function setup(format: CustomCapabilityApiFormat) {
  const server = await startCustomCapabilityProtocolServer();
  servers.push(server);
  const pathname =
    format === 'cohere_rerank'
      ? '/v2'
      : format === 'paddle_layout_parsing'
        ? '/layout-parsing'
        : format === 'paddle_ocr_jobs'
          ? ''
          : '/v1';
  const command = CustomCapabilityModelCommandSchema.parse({
    api_format: format,
    provider_name: format,
    base_url: server.baseUrl + pathname,
    api_key: 'fixture-key',
    endpoint_model_id: `${format}-fixture`,
    ...(format.startsWith('paddle_') ? { ocr_mode: 'document_upload' } : {}),
  });
  return { server, command };
}

const JsonObject = z.record(z.string(), z.unknown());
describe('自定义模型从配置命令到真实 Host/SDK/HTTP 的协议验收', () => {
  it('正式文本/视觉SDK解码Chat SSE，错误不退回其他协议', async () => {
    const server = await startCustomCapabilityProtocolServer();
    servers.push(server);
    server.setChatResponse(request => `Synthetic response for ${request.model}`);
    const route: AiSdkInferenceRoute = {
      model_id: 'local-chat',
      request_profile: 'openai_chat',
      capability_id: 'ai-sdk:openai-chat',
      endpoint_id: 'fixture',
      endpoint_model_id: 'fixture-chat',
      surface: 'openai_chat_completions',
      base_url: `${server.baseUrl}/v1`,
      headers: {},
    };
    const capability = createAiSdkInferenceCapability(route.capability_id, route.surface, {
      language_models: createAiSdkLanguageModelRegistry(),
    });
    const port = createTextGenerationPort({
      inferencePort: {
        stream: request =>
          capability.stream({
            request,
            route,
            credential: { profile: 'bearer', secret: 'fixture-key' },
          }),
      },
    });
    const request = {
      modelId: 'local-chat',
      messages: [
        {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: 'Synthetic apple image' },
            {
              type: 'image' as const,
              mediaType: 'image/png' as const,
              bytes: Buffer.from(MODEL_CONNECTION_TEST_PNG, 'base64'),
            },
          ],
        },
      ],
    };
    expect((await port.generate(request)).text).toBe('Synthetic response for fixture-chat');
    expect(server.requests[0]).toMatchObject({ method: 'POST', path: '/v1/chat/completions' });
    expect(server.requests[0].headers.authorization).toBe('Bearer fixture-key');
    expect(JSON.parse(server.requests[0].body)).toMatchObject({
      model: 'fixture-chat',
      stream: true,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Synthetic apple image' },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${MODEL_CONNECTION_TEST_PNG}` },
            },
          ],
        },
      ],
    });
    server.setFailure('unauthorized');
    await expect(port.generate(request)).rejects.toMatchObject({
      code: 'provider_http_401',
      retryable: false,
    });
    expect(server.requests).toHaveLength(2);
  });

  it.each([1, 3])('Cohere按真实%d条候选返回有效索引，不制造第二条结果', async count => {
    const { server, command } = await setup('cohere_rerank');
    const { model } = buildCustomCapabilityRegistration(command, 'fixture', 'fixture');
    const port = createRerankingPort({
      catalog: {
        async initialize() {},
        getModel: () => model,
        resolveCredential: () => command.api_key,
      },
    });
    const documents = Array.from({ length: count }, (_, index) => `Apple document ${index}`);
    const result = await port.rerank({ modelId: model.id, query: 'apple', documents });
    expect(result.ranking.map(item => item.originalIndex)).toEqual(
      documents.map((_, index) => index)
    );
    expect(server.requests[0].path).toBe('/v2/rerank');
  });
  it.each([
    'openai_embeddings',
    'cohere_rerank',
    'openai_images_generations',
    'paddle_layout_parsing',
    'paddle_ocr_jobs',
  ] as const)('%s 调用正式适配器并解码合成响应，未保存配置', async format => {
    const { server, command } = await setup(format);
    const result = await testCustomCapabilityModel(command, new AbortController().signal);
    expect(result.message).toContain('调用成功');
    expect(result.message).toContain('尚未保存');
    const request = server.requests[0];
    expect(request.method).toBe('POST');
    expect(request.headers.authorization?.toLowerCase()).toBe(
      `${format === 'paddle_layout_parsing' ? 'token' : 'bearer'} fixture-key`
    );
    if (format === 'paddle_ocr_jobs') {
      expect(request.path).toBe('/api/v2/ocr/jobs');
      expect(request.headers['content-type']).toContain('multipart/form-data');
      expect(request.body).toContain('name="model"');
      expect(request.body).toContain(command.endpoint_model_id);
      expect(request.body).toContain('%PDF-1.7');
      expect(server.requests.map(item => item.path)).toEqual([
        '/api/v2/ocr/jobs',
        '/api/v2/ocr/jobs/fixture-job',
        '/result.jsonl',
      ]);
      expect(server.requests[2].headers.authorization).toBeUndefined();
    } else {
      const payload = JsonObject.parse(JSON.parse(request.body));
      if (format === 'paddle_layout_parsing') {
        expect(request.path).toBe('/layout-parsing');
        expect(payload.fileType).toBe(0);
        const pdf = z.string().parse(payload.file);
        expect(Buffer.from(pdf, 'base64').toString('latin1')).toContain('Linnya model test 123');
      } else {
        expect(payload.model).toBe(command.endpoint_model_id);
        if (format === 'openai_embeddings') {
          expect(request.path).toBe('/v1/embeddings');
          expect(payload.input).toEqual(['Linnya model connection test']);
        }
        if (format === 'cohere_rerank') {
          expect(request.path).toBe('/v2/rerank');
          expect(payload.documents).toHaveLength(2);
          expect(payload.top_n).toBe(2);
        }
        if (format === 'openai_images_generations') {
          expect(request.path).toBe('/v1/images/generations');
          expect(payload.response_format).toBe('b64_json');
          expect(payload.n).toBe(1);
        }
      }
      expect(server.requests).toHaveLength(1);
    }
  });

  it.each([
    'openai_embeddings',
    'cohere_rerank',
    'openai_images_generations',
    'paddle_layout_parsing',
    'paddle_ocr_jobs',
  ] as const)('%s 鉴权与协议错误明确失败，不自动切换或泄漏正文', async format => {
    const { server, command } = await setup(format);
    server.setFailure('unauthorized');
    await expect(testCustomCapabilityModel(command, new AbortController().signal)).rejects.toThrow(
      'API Key'
    );
    expect(server.requests).toHaveLength(1);
    server.setFailure('wrong_format');
    await expect(testCustomCapabilityModel(command, new AbortController().signal)).rejects.toThrow(
      '接口格式'
    );
    expect(server.requests).toHaveLength(2);
  });

  it('Paddle Jobs受理后取消停止本地轮询请求，不伪造远端取消调用', async () => {
    const { server, command } = await setup('paddle_ocr_jobs');
    server.setDelay(1000, '/api/v2/ocr/jobs/fixture-job');
    const controller = new AbortController();
    const result = testCustomCapabilityModel(command, controller.signal);
    const rejected = expect(result).rejects.toThrow('测试已取消');
    await vi.waitFor(() => expect(server.requests).toHaveLength(2));
    controller.abort();
    await rejected;
    await vi.waitFor(() => expect(server.cancelledRequestCount).toBe(1));
    expect(server.requests.map(request => request.path)).toEqual([
      '/api/v2/ocr/jobs',
      '/api/v2/ocr/jobs/fixture-job',
    ]);
  });

  it('无需鉴权的本地embedding端点不伪造Key', async () => {
    const { server, command } = await setup('openai_embeddings');
    await testCustomCapabilityModel(
      { ...command, api_key: undefined },
      new AbortController().signal
    );
    expect(server.requests[0].headers.authorization).toBeUndefined();
  });
});
