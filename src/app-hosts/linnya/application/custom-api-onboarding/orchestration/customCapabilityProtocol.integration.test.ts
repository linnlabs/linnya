import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  CustomCapabilityModelCommandSchema,
  type CustomCapabilityApiFormat,
} from '@app/schemas/custom-api-onboarding';
import { testCustomCapabilityModel } from './testCustomCapabilityModel';
import { startCustomCapabilityProtocolServer } from '../__tests__/fixtures/customCapabilityProtocolServer';

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
