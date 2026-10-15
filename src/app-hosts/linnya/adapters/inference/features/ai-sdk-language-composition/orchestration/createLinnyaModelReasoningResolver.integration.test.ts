import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelConfig } from 'src/domains/model-catalog';
import { createSourceDistributionIdentity } from 'src/shared/distribution-identity';
import { createLinnyaModelReasoningResolver } from './createLinnyaModelReasoningResolver';

const paths = vi.hoisted(() => ({ directory: '' }));
vi.mock('src/shared/utils/pathManager', () => ({
  pathManager: {
    getUserModelsConfigPath: async () => `${paths.directory}/user_models.json`,
    getEndpointCredentialsConfigPath: () => `${paths.directory}/endpoint_credentials.json`,
  },
}));

describe('Host SDK 能力装配', () => {
  beforeEach(async () => {
    vi.resetModules();
    paths.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-sdk-reasoning-'));
    vi.stubEnv(
      'MODEL_REGISTRY_DEFAULTS_PATH',
      path.resolve('src/domains/model-catalog/features/default-catalog/assets/default_models.json')
    );
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(paths.directory, { recursive: true, force: true });
  });

  it('已有自定义模型从实际文件恢复后，通过 endpoint 模型名获得真实 SDK 能力，无需重新添加', async () => {
    const model: ModelConfig = {
      id: 'existing-user-model',
      model_name: 'claude-haiku-5-5',
      display_name: 'My Claude',
      description: '',
      catalog_source: 'user',
      billing_mode: 'byok',
      capabilities: ['chat'],
      ui_visibility: ['chat'],
      custom_provider_name: 'Relay',
      inference_endpoint_id: 'existing-endpoint',
      inference_route: {
        api_surface: 'anthropic_messages',
        capability_id: 'ai-sdk:anthropic-messages',
        endpoint_id: 'custom-relay',
        endpoint_model_id: 'claude-haiku-5-5',
        base_url: 'https://relay.example/v1',
        auth_profile: 'api_key',
        context_window_tokens: 200_000,
        max_output_tokens: 8_192,
        input_support: { user_image: true, tool_result_image: true },
        usage: { response_usage: 'provider_reported_optional' },
        continuation: { tool_replay: 'required' },
      },
    };
    const file = path.join(paths.directory, 'user_models.json');
    const stored = JSON.stringify({
      version: '5.0.0',
      last_updated: '2026-10-01T00:00:00.000Z',
      models: [model],
      inference_endpoints: [{
        id: 'existing-endpoint',
        route_profile_id: 'anthropic_messages',
        endpoint_id: 'custom-relay',
        base_url: 'https://relay.example/v1',
        auth_profile: 'api_key',
        credential_reference: { kind: 'stored_secret', credential_id: 'existing-key' },
      }],
      custom_api_groups: [{ name: 'Relay', inference_endpoint_ids: ['existing-endpoint'] }],
    });
    await fs.writeFile(file, stored);

    const { ModelCatalogRegistry } = await import('src/domains/model-catalog');
    const catalog = ModelCatalogRegistry.getInstance();
    catalog.installModelReasoningResolver(createLinnyaModelReasoningResolver());
    await catalog.initialize(createSourceDistributionIdentity());

    expect(catalog.getModel(model.id)).toMatchObject({
      id: model.id,
      model_name: model.model_name,
      inference_endpoint_id: 'existing-endpoint',
      reasoning: {
        supported_efforts: ['off', 'low', 'medium', 'high', 'xhigh'],
        default_effort: 'medium',
      },
    });
    // 能力查询只重建运行时投影，不改用户文件和连接身份，也不需要解密凭据。
    expect(await fs.readFile(file, 'utf8')).toBe(stored);
    expect(catalog.getCustomApiGroups()).toEqual([
      { name: 'Relay', inference_endpoint_ids: ['existing-endpoint'] },
    ]);

    // 编辑会带回旧 DTO：旧型号的自动档位不能限制新型号，实际 SDK 仍是能力来源。
    for (const modelName of ['claude-sonnet-4-6', 'claude-sonnet-5-5']) {
      const current = catalog.getModel(model.id);
      if (!current?.inference_route) throw new Error('fixture model missing');
      await catalog.updateModel({
        ...current,
        model_name: modelName,
        inference_route: { ...current.inference_route, endpoint_model_id: modelName },
      });
    }
    expect(catalog.getModel(model.id)?.reasoning).toEqual({
      supported_efforts: ['low', 'medium', 'high', 'xhigh'],
      default_effort: 'medium',
    });
  });

  it('同名模型不能跨 codec 借用 Anthropic 能力，未知 capability 不产生能力声明', () => {
    const resolve = createLinnyaModelReasoningResolver();
    for (const capability_id of ['ai-sdk:openai-compatible', 'host:mock'] as const) {
      expect(resolve({ capability_id, endpoint_model_id: 'claude-haiku-5-5' })).toBeUndefined();
    }
    expect(resolve({
      capability_id: 'ai-sdk:anthropic-messages',
      endpoint_model_id: 'claude-future-model',
    })).toBeUndefined();
  });
});
