import { describe, expect, it, vi } from 'vitest';
import type { ModelConfig } from 'src/domains/model-catalog';
import { ImageGenerationFailure } from 'src/domains/image-generation';
import { createInMemoryProviderOutboundDiagnostics } from 'src/domains/provider-diagnostics/features/provider-outbound';
import { ModelRequestCredentialError } from '../../model-request-auth';
import { createImageGenerationPort } from './createImageGenerationPort';

function imageModel(): ModelConfig {
  return {
    id: 'image-model',
    model_name: 'seedream-model',
    catalog_source: 'default',
    credential_reference: {
      kind: 'environment_variable',
      environment_variable: 'IMAGE_API_KEY',
    },
    capabilities: ['image_generation'],
    ui_visibility: ['image_generation'],
    display_name: 'Image Model',
    description: '',
    image_generation_route: {
      api_surface: 'openai_images_generations',
      capability_id: 'ai-sdk:openai-compatible-image-generation',
      endpoint_id: 'volcengine',
      endpoint_model_id: 'seedream-model',
      base_url: 'https://provider.example/v1',
      auth_profile: 'bearer',
      response_format: 'b64_json',
      max_images_per_call: 1,
    },
    image_generation: {
      min_pixels: 3_686_400,
      allowed_sizes: ['2K', '2048x2048'],
    },
  };
}

describe('createImageGenerationPort', () => {
  it('按 typed route/credential 调用 capability，并写入不含 prompt 的安全诊断', async () => {
    const diagnostics = createInMemoryProviderOutboundDiagnostics();
    const invoke = vi.fn(async () => ({
      model: 'seedream-model',
      images: [{ bytes: new Uint8Array([137, 80, 78, 71]) }],
    }));
    const port = createImageGenerationPort({
      catalog: {
        async initialize() {},
        getModel: () => imageModel(),
      },
      credentialResolver: {
        resolve: async () => ({ profile: 'bearer', secret: 'image-secret' }),
      },
      invoke,
      outbound_diagnostics: diagnostics,
    });

    const result = await port.generate({
      modelId: 'image-model',
      prompt: '机密提示词',
      size: '2K',
      count: 1,
    });

    expect(result.images).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'volcengine',
        providerModelId: 'seedream-model',
        apiKey: 'image-secret',
        maxImagesPerCall: 1,
      }),
      expect.objectContaining({ size: '2K', count: 1 })
    );
    expect(diagnostics.readLatest()).toMatchObject({
      operation: 'image_generation',
      input: { kind: 'image_generation', requested_image_count: 1 },
      status: 'succeeded',
      usage: { provenance: 'not_reported' },
    });
    expect(JSON.stringify(diagnostics.readLatest())).not.toContain('机密提示词');
    expect(JSON.stringify(diagnostics.readLatest())).not.toContain('image-secret');
  });

  it('Provider 错误只投影稳定分类，不泄露原始错误正文', async () => {
    const port = createImageGenerationPort({
      catalog: {
        async initialize() {},
        getModel: () => imageModel(),
      },
      credentialResolver: {
        resolve: async () => ({ profile: 'bearer', secret: 'image-secret' }),
      },
      invoke: async () => {
        throw new Error('sensitive provider response');
      },
    });
    let failure: unknown;
    try {
      await port.generate({
        modelId: 'image-model',
        prompt: '测试',
        size: '2048x2048',
        count: 1,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ImageGenerationFailure);
    expect(failure).toMatchObject({
      kind: 'protocol',
      code: 'provider_protocol_error',
      retryable: false,
    });
    expect(String(failure)).not.toContain('sensitive provider response');
  });

  it('非法图片数量在读取目录和调用 Provider 前失败', async () => {
    const initialize = vi.fn(async () => undefined);
    const invoke = vi.fn();
    const port = createImageGenerationPort({
      catalog: {
        initialize,
        getModel: () => imageModel(),
      },
      credentialResolver: {
        resolve: async () => ({ profile: 'bearer', secret: 'image-secret' }),
      },
      invoke,
    });
    await expect(
      port.generate({
        modelId: 'image-model',
        prompt: '测试',
        size: '2048x2048',
        count: 5,
      })
    ).rejects.toMatchObject({ code: 'image_count_invalid' });
    expect(initialize).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('把 Provider account 解析出的账号身份头传给图片 capability', async () => {
    const invoke = vi.fn(async () => ({
      model: 'seedream-model',
      images: [{ bytes: new Uint8Array([137, 80, 78, 71]) }],
    }));
    const resolve = vi.fn(async () => ({
      profile: 'bearer' as const,
      secret: 'oauth-access-token',
      request_headers: {
        'chatgpt-account-id': 'upstream-account',
        originator: 'linnya',
      },
    }));
    const port = createImageGenerationPort({
      catalog: {
        async initialize() {},
        getModel: () => imageModel(),
      },
      credentialResolver: { resolve },
      invoke,
    });

    await port.generate({
      modelId: 'image-model',
      prompt: '测试',
      size: '2048x2048',
      count: 1,
    });

    expect(resolve).toHaveBeenCalledWith({
      model_id: 'image-model',
      endpoint_id: 'volcengine',
      auth_profile: 'bearer',
    });
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'oauth-access-token',
        headers: {
          'chatgpt-account-id': 'upstream-account',
          originator: 'linnya',
        },
      }),
      expect.anything()
    );
  });

  it('账号凭证不可用时在调用图片 Provider 前返回稳定错误', async () => {
    const invoke = vi.fn();
    const port = createImageGenerationPort({
      catalog: {
        async initialize() {},
        getModel: () => imageModel(),
      },
      credentialResolver: {
        resolve: async () => {
          throw new ModelRequestCredentialError('sensitive credential detail');
        },
      },
      invoke,
    });

    await expect(
      port.generate({
        modelId: 'image-model',
        prompt: '测试',
        size: '2048x2048',
        count: 1,
      })
    ).rejects.toMatchObject({
      kind: 'protocol',
      code: 'credential_missing',
      retryable: false,
    });
    expect(invoke).not.toHaveBeenCalled();
  });
});
