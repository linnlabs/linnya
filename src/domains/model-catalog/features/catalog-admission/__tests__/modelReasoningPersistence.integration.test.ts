import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelReasoningConfig } from '@linnlabs/linnkit/contracts';

import type {
  ModelCatalog,
  ModelConfig,
  UserModelRegistration,
} from '../../../definitions/modelCatalog';
import type { ModelReasoningResolver } from '../../../definitions/modelReasoningResolver';
import type { InferenceEndpointSelection } from '../../../definitions/inferenceEndpoint';
import { createSourceDistributionIdentity } from '../../../../../shared/distribution-identity';

const paths = vi.hoisted(() => ({ directory: '' }));
vi.mock('src/shared/utils/pathManager', () => ({
  pathManager: {
    getUserModelsConfigPath: async () => `${paths.directory}/user_models.json`,
    getEndpointCredentialsConfigPath: () => `${paths.directory}/endpoint_credentials.json`,
  },
}));

function model(id: string, reasoning?: ModelReasoningConfig): ModelConfig {
  return {
    id,
    model_name: 'claude-haiku-5-5',
    display_name: id,
    description: '',
    catalog_source: 'user',
    billing_mode: 'byok',
    capabilities: ['chat'],
    ui_visibility: [],
    custom_provider_name: 'Relay',
    reasoning,
    inference_route: {
      api_surface: 'anthropic_messages',
      capability_id: 'ai-sdk:anthropic-messages',
      endpoint_id: 'custom-anthropic-compatible:fixture',
      endpoint_model_id: 'claude-haiku-5-5',
      base_url: 'https://relay.example/v1',
      auth_profile: 'api_key',
      context_window_tokens: 32_768,
      max_output_tokens: 4_096,
      input_support: { user_image: false, tool_result_image: false },
      usage: { response_usage: 'provider_reported_optional' },
      continuation: { tool_replay: 'optional' },
    },
  };
}

async function openRegistry(resolver?: ModelReasoningResolver): Promise<ModelCatalog> {
  vi.resetModules();
  const { ModelCatalogRegistry } = await import('../../../registry/modelCatalogRegistry');
  const registry = ModelCatalogRegistry.getInstance();
  if (resolver) registry.installModelReasoningResolver(resolver);
  registry.installEndpointCredentialCodec({
    encrypt: async plaintext => Buffer.from(plaintext).toString('base64'),
    decrypt: async ciphertext => Buffer.from(ciphertext, 'base64').toString(),
  });
  await registry.initialize(createSourceDistributionIdentity());
  return registry;
}

async function seedModels(models: ModelConfig[]): Promise<void> {
  const catalog = await openRegistry();
  const registrations: UserModelRegistration[] = models.map((item, index) => ({
    model: item,
    endpoint:
      index === 0
        ? {
            kind: 'create',
            endpoint: {
              id: 'endpoint-a',
              route_profile_id: 'anthropic_messages',
              endpoint_id: 'custom-anthropic-compatible:fixture',
              base_url: 'https://relay.example/v1',
              auth_profile: 'api_key',
              credential_secret: 'fixture-key',
            },
          }
        : { kind: 'existing', inference_endpoint_id: 'endpoint-a' },
  }));
  await catalog.registerCustomApiModels('Relay', registrations, catalog.getUserRevision());
}

function requireModel(catalog: ModelCatalog, id: string): ModelConfig {
  const value = catalog.getModel(id);
  if (!value) throw new Error(`fixture model missing: ${id}`);
  return value;
}

function renameModel(value: ModelConfig, name: string): ModelConfig {
  if (!value.inference_route) throw new Error('fixture language route missing');
  return {
    ...value,
    model_name: name,
    inference_route: { ...value.inference_route, endpoint_model_id: name },
  };
}

async function readUserFile(): Promise<string> {
  return fs.readFile(path.join(paths.directory, 'user_models.json'), 'utf8');
}

const queryReasoning: ModelReasoningResolver = route =>
  route.capability_id === 'ai-sdk:anthropic-messages'
    ? { supported_efforts: ['low', 'medium', 'high'] }
    : undefined;

const queryVersionedReasoning: ModelReasoningResolver = route => {
  if (
    route.capability_id === 'ai-sdk:openai-chat' &&
    route.endpoint_model_id === 'claude-sonnet-4-6'
  ) {
    return { supported_efforts: ['minimal', 'xhigh'], default_effort: 'xhigh' };
  }
  if (route.capability_id !== 'ai-sdk:anthropic-messages') return undefined;
  return {
    supported_efforts:
      route.endpoint_model_id === 'claude-sonnet-4-6'
        ? ['off', 'low', 'medium', 'high']
        : ['low', 'medium', 'high', 'xhigh'],
  };
};

describe('SDK 能力装配与真实用户目录持久化', () => {
  beforeEach(async () => {
    paths.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-reasoning-admission-'));
    vi.stubEnv(
      'MODEL_REGISTRY_DEFAULTS_PATH',
      path.resolve('src/domains/model-catalog/features/default-catalog/assets/default_models.json')
    );
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(paths.directory, { recursive: true, force: true });
  });

  it('已有5.5启动即获得能力，保存不固化自动档位，重启采用新SDK并保留显式窄范围和默认值', async () => {
    await seedModels([
      model('automatic'),
      model('narrow', { supported_efforts: ['medium', 'high'], default_effort: 'high' }),
      model('custom-default', {
        supported_efforts: ['low', 'medium', 'high'],
        default_effort: 'low',
      }),
      model('old-off', {
        supported_efforts: ['off', 'low', 'medium', 'high'],
        default_effort: 'off',
      }),
    ]);
    let catalog = await openRegistry(queryReasoning);
    expect(requireModel(catalog, 'automatic').reasoning).toEqual({
      supported_efforts: ['low', 'medium', 'high'],
      default_effort: 'medium',
    });
    expect(requireModel(catalog, 'old-off').reasoning).toEqual({
      supported_efforts: ['low', 'medium', 'high'],
      default_effort: 'medium',
    });
    await catalog.updateModel({
      ...requireModel(catalog, 'automatic'),
      display_name: 'User changed title',
    });
    const { readStoredUserModelState } = await import(
      '../../user-model-persistence/functions/readStoredUserModelState'
    );
    const saved = readStoredUserModelState(JSON.parse(await readUserFile()));
    expect(saved.models).toContainEqual(
      expect.objectContaining({
        id: 'narrow',
        reasoning: { supported_efforts: ['medium', 'high'], default_effort: 'high' },
      })
    );
    expect(saved.models).toContainEqual(
      expect.objectContaining({
        id: 'custom-default',
        reasoning: { supported_efforts: ['low', 'medium', 'high'], default_effort: 'low' },
      })
    );
    for (const entry of saved.models) {
      if (typeof entry !== 'object' || entry === null) throw new Error('fixture model shape');
      if (Reflect.get(entry, 'id') === 'automatic' || Reflect.get(entry, 'id') === 'old-off') {
        expect(Reflect.has(entry, 'reasoning')).toBe(false);
      }
    }
    catalog = await openRegistry(route =>
      route.capability_id === 'ai-sdk:anthropic-messages'
        ? { supported_efforts: ['low', 'medium', 'high', 'xhigh'] }
        : undefined
    );
    expect(requireModel(catalog, 'automatic')).toMatchObject({
      id: 'automatic',
      display_name: 'User changed title',
      reasoning: {
        supported_efforts: ['low', 'medium', 'high', 'xhigh'],
        default_effort: 'medium',
      },
    });
    expect(requireModel(catalog, 'narrow').reasoning).toEqual({
      supported_efforts: ['medium', 'high'],
      default_effort: 'high',
    });
    expect(requireModel(catalog, 'custom-default').reasoning).toEqual({
      supported_efforts: ['low', 'medium', 'high'],
      default_effort: 'low',
    });
    expect(() => catalog.installModelReasoningResolver(queryReasoning)).toThrow('initialize 前');
  });

  it('完全冲突的显式声明阻断准入并保留原文件，不把它伪装成无思考能力', async () => {
    await seedModels([model('conflict', { supported_efforts: ['off'], default_effort: 'off' })]);
    const before = await readUserFile();
    await expect(openRegistry(queryReasoning)).rejects.toThrow('claude-haiku-5-5');
    expect(await readUserFile()).toBe(before);
  });

  it.each(['update', 'diff', 'custom-group-diff'] as const)(
    '%s 修改模型身份重新推导自动档位，显式约束和本次新声明保存重启后仍保留',
    async mutation => {
      await seedModels(
        [
          model('automatic'),
          model('narrow', { supported_efforts: ['medium', 'high'], default_effort: 'high' }),
          model('custom-default', {
            supported_efforts: ['off', 'low', 'medium', 'high'],
            default_effort: 'low',
          }),
          model('new-declaration'),
        ].map(value => renameModel(value, 'claude-sonnet-4-6'))
      );
      let catalog = await openRegistry(queryVersionedReasoning);
      expect(requireModel(catalog, 'automatic').reasoning?.supported_efforts).toEqual([
        'off',
        'low',
        'medium',
        'high',
      ]);
      const updated = ['automatic', 'narrow', 'custom-default', 'new-declaration'].map(id => {
        const value = renameModel(requireModel(catalog, id), 'claude-sonnet-5-5');
        return id === 'new-declaration'
          ? {
              ...value,
              reasoning: {
                supported_efforts: ['high'],
                default_effort: 'high',
              } satisfies ModelReasoningConfig,
            }
          : value;
      });
      if (mutation === 'update') {
        for (const value of updated) await catalog.updateModel(value);
      } else if (mutation === 'diff') {
        await catalog.applyDiff({ added: [], updated, removed: [] }, catalog.getUserRevision());
      } else {
        await catalog.applyCustomApiGroupModelDiff(
          'Relay',
          { added: [], updated, removed: [] },
          catalog.getUserRevision()
        );
      }
      const expected = [
        { supported_efforts: ['low', 'medium', 'high', 'xhigh'], default_effort: 'medium' },
        { supported_efforts: ['medium', 'high'], default_effort: 'high' },
        { supported_efforts: ['low', 'medium', 'high'], default_effort: 'low' },
        { supported_efforts: ['high'], default_effort: 'high' },
      ];
      expect(updated.map(value => requireModel(catalog, value.id).reasoning)).toEqual(expected);
      const { readStoredUserModelState } = await import(
        '../../user-model-persistence/functions/readStoredUserModelState'
      );
      const saved = readStoredUserModelState(JSON.parse(await readUserFile()));
      const automatic = saved.models.find(
        value =>
          typeof value === 'object' && value !== null && Reflect.get(value, 'id') === 'automatic'
      );
      expect(automatic).toBeDefined();
      expect(automatic).not.toHaveProperty('reasoning');
      catalog = await openRegistry(queryVersionedReasoning);
      expect(updated.map(value => requireModel(catalog, value.id).reasoning)).toEqual(expected);
      expect(requireModel(catalog, 'automatic').inference_route?.endpoint_model_id).toBe(
        'claude-sonnet-5-5'
      );
    }
  );

  it.each([
    { mutation: 'user-models', modelName: 'claude-sonnet-4-6' },
    { mutation: 'custom-api-group', modelName: 'claude-sonnet-4-6' },
    { mutation: 'custom-api-group', modelName: 'claude-sonnet-5-5' },
  ])(
    '$mutation 改绑 $modelName 协议不会沿用旧自动 Claude 档位，真实保存与重启结果一致',
    async ({ mutation, modelName }) => {
      await seedModels([renameModel(model('automatic'), modelName)]);
      let catalog = await openRegistry(queryVersionedReasoning);
      const current = requireModel(catalog, 'automatic');
      expect(current.reasoning).toBeDefined();
      if (!current.inference_route) throw new Error('fixture language route missing');
      const updated: ModelConfig = {
        ...current,
        inference_route: {
          ...current.inference_route,
          api_surface: 'openai_chat_completions',
          capability_id: 'ai-sdk:openai-chat',
          endpoint_id: 'custom-openai-compatible:fixture',
          auth_profile: 'bearer',
        },
      };
      const endpoint: InferenceEndpointSelection = {
        kind: 'create',
        endpoint: {
          id: 'endpoint-b',
          route_profile_id: 'openai_chat',
          endpoint_id: 'custom-openai-compatible:fixture',
          base_url: 'https://relay.example/v1',
          auth_profile: 'bearer',
          credential_secret: 'fixture-new-key',
        },
      };
      if (mutation === 'user-models') {
        await catalog.rebindUserModels([updated], endpoint, catalog.getUserRevision());
      } else {
        await catalog.rebindCustomApiGroup(
          'Relay',
          'Relay',
          [updated],
          endpoint,
          catalog.getUserRevision()
        );
      }
      const expected =
        modelName === 'claude-sonnet-4-6'
          ? { supported_efforts: ['minimal', 'xhigh'], default_effort: 'xhigh' }
          : undefined;
      expect(requireModel(catalog, 'automatic').reasoning).toEqual(expected);
      catalog = await openRegistry(queryVersionedReasoning);
      expect(requireModel(catalog, 'automatic')).toMatchObject({
        inference_endpoint_id: 'endpoint-b',
        inference_route: { capability_id: 'ai-sdk:openai-chat' },
        reasoning: expected,
      });
    }
  );
});
