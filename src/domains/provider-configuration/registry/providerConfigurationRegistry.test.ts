import { describe, expect, it } from 'vitest';

import type {
  ProviderConfigurationCatalogProjection,
  ProviderConfigurationRepository,
  ProviderConfigurationSnapshot,
} from '../definitions/providerConfiguration';
import { ProviderConfigurationRegistry } from './providerConfigurationRegistry';

function emptySnapshot(): ProviderConfigurationSnapshot {
  return {
    legacy_formal_provider_migration: 'pending',
    configured_providers: [],
    pending_model_registrations: [],
    pending_model_removals: [],
  };
}

function catalog(
  models: ProviderConfigurationCatalogProjection['models'] = []
): ProviderConfigurationCatalogProjection {
  return { models };
}

class MemoryRepository implements ProviderConfigurationRepository {
  readonly saves: ProviderConfigurationSnapshot[] = [];

  constructor(private snapshot: ProviderConfigurationSnapshot = emptySnapshot()) {}

  async load(): Promise<ProviderConfigurationSnapshot> {
    return structuredClone(this.snapshot);
  }

  async save(snapshot: ProviderConfigurationSnapshot): Promise<void> {
    this.snapshot = structuredClone(snapshot);
    this.saves.push(structuredClone(snapshot));
  }

  current(): ProviderConfigurationSnapshot {
    return structuredClone(this.snapshot);
  }
}

const registration = {
  intent_id: 'registration-1',
  configured_provider_id: 'configured-openai',
  provider_definition_id: 'openai',
  provider_connection_definition_id: 'openai-api',
  inference_endpoint_id: 'openai:boundary-1',
  provider_model_id: 'gpt-5.6-sol',
  model_config_id: 'model-gpt-5.6-sol',
} as const;

describe('ProviderConfigurationRegistry', () => {
  it('后台同步与用户操作并发时保留各自 intent、提交和删除结果', async () => {
    const repository = new MemoryRepository();
    const registry = new ProviderConfigurationRegistry(repository);
    await registry.initialize(catalog());
    const second = {
      ...registration,
      intent_id: 'registration-2',
      configured_provider_id: 'configured-subscription',
      provider_connection_definition_id: 'openai-chatgpt-subscription',
      model_config_id: 'subscription-model',
    };
    await Promise.all([
      registry.beginModelRegistration(registration),
      registry.beginModelRegistration(second),
    ]);
    expect(repository.current().pending_model_registrations).toHaveLength(2);
    await Promise.all([
      registry.completeModelRegistration(registration.intent_id),
      registry.completeModelRegistration(second.intent_id),
    ]);
    expect(registry.list()).toHaveLength(2);
    expect(repository.current().pending_model_registrations).toEqual([]);
    await Promise.all([
      registry.beginModelRemoval({ intent_id: 'remove-1', model_config_id: registration.model_config_id }),
      registry.beginModelRemoval({ intent_id: 'remove-2', model_config_id: second.model_config_id }),
    ]);
    await Promise.all([registry.completeModelRemoval('remove-1'), registry.completeModelRemoval('remove-2')]);
    expect(registry.list()).toEqual([]);
    expect(repository.current().pending_model_removals).toEqual([]);
  });

  it('一条写盘失败不发布内存状态，已排队的后续命令仍可完成', async () => {
    const memory = new MemoryRepository();
    let failNextSave = true;
    const repository: ProviderConfigurationRepository = {
      load: () => memory.load(),
      async save(snapshot) {
        if (failNextSave) {
          failNextSave = false;
          throw new Error('fixture disk write failed');
        }
        await memory.save(snapshot);
      },
    };
    const registry = new ProviderConfigurationRegistry(repository);
    await registry.initialize(catalog());
    const first = registry.beginModelRegistration(registration);
    const next = registry.beginModelRegistration({ ...registration, intent_id: 'retry-intent' });
    await expect(first).rejects.toThrow('fixture disk write failed');
    await next;
    await registry.completeModelRegistration('retry-intent');
    expect(registry.getByModelConfigId(registration.model_config_id)).toBeDefined();
    expect(memory.current().pending_model_registrations).toEqual([]);
  });

  it('先持久化注册意图，再提交稳定 Provider 与模型归属', async () => {
    const repository = new MemoryRepository();
    const registry = new ProviderConfigurationRegistry(repository);
    await registry.initialize(catalog());

    await registry.beginModelRegistration(registration);
    expect(repository.current().pending_model_registrations).toEqual([
      {
        id: registration.intent_id,
        configured_provider_id: registration.configured_provider_id,
        provider_definition_id: registration.provider_definition_id,
        provider_connection_definition_id: registration.provider_connection_definition_id,
        inference_endpoint_id: registration.inference_endpoint_id,
        provider_model_id: registration.provider_model_id,
        model_config_id: registration.model_config_id,
      },
    ]);

    await registry.completeModelRegistration(registration.intent_id);
    expect(registry.getByProviderConnectionDefinitionId('openai-api')).toEqual({
      id: 'configured-openai',
      provider_definition_id: 'openai',
      provider_connection_definition_id: 'openai-api',
      models: [
        {
          provider_model_id: 'gpt-5.6-sol',
          model_config_id: 'model-gpt-5.6-sol',
        },
      ],
    });
    expect(repository.current().pending_model_registrations).toEqual([]);
  });

  it('启动时只按稳定 ID 提交已经写入 Model Catalog 的注册意图', async () => {
    const snapshot: ProviderConfigurationSnapshot = {
      ...emptySnapshot(),
      pending_model_registrations: [
        {
          id: registration.intent_id,
          configured_provider_id: registration.configured_provider_id,
          provider_definition_id: registration.provider_definition_id,
          provider_connection_definition_id: registration.provider_connection_definition_id,
          inference_endpoint_id: registration.inference_endpoint_id,
          provider_model_id: registration.provider_model_id,
          model_config_id: registration.model_config_id,
        },
      ],
    };
    const repository = new MemoryRepository(snapshot);
    const registry = new ProviderConfigurationRegistry(repository);

    await registry.initialize(
      catalog([
        {
          id: registration.model_config_id,
          inference_endpoint_id: registration.inference_endpoint_id,
        },
      ])
    );

    expect(registry.getByModelConfigId(registration.model_config_id)?.provider_definition_id).toBe(
      'openai'
    );
    expect(repository.current().pending_model_registrations).toEqual([]);
  });

  it('启动时撤销未写入 Model Catalog 的注册意图', async () => {
    const repository = new MemoryRepository({
      ...emptySnapshot(),
      pending_model_registrations: [
        {
          id: registration.intent_id,
          configured_provider_id: registration.configured_provider_id,
          provider_definition_id: registration.provider_definition_id,
          provider_connection_definition_id: registration.provider_connection_definition_id,
          inference_endpoint_id: registration.inference_endpoint_id,
          provider_model_id: registration.provider_model_id,
          model_config_id: registration.model_config_id,
        },
      ],
    });
    const registry = new ProviderConfigurationRegistry(repository);

    await registry.initialize(catalog());

    expect(registry.list()).toEqual([]);
    expect(repository.current().pending_model_registrations).toEqual([]);
  });

  it('删除完成后移除模型归属，并在最后一个模型删除时移除 Provider 配置', async () => {
    const repository = new MemoryRepository();
    const registry = new ProviderConfigurationRegistry(repository);
    await registry.initialize(catalog());
    await registry.beginModelRegistration(registration);
    await registry.completeModelRegistration(registration.intent_id);

    const removal = await registry.beginModelRemoval({
      intent_id: 'removal-1',
      model_config_id: registration.model_config_id,
    });
    expect(removal?.id).toBe('removal-1');
    await registry.completeModelRemoval('removal-1');

    expect(registry.list()).toEqual([]);
    expect(repository.current().pending_model_removals).toEqual([]);
  });
});
