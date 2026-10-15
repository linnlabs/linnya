import { describe, expect, it, vi } from 'vitest';
import type { ModelConfig } from 'src/domains/model-catalog';
import { ProviderConfigurationRegistry } from 'src/domains/provider-configuration';
import { runCustomApiGroupMigration } from './runCustomApiGroupMigration';

function model(id: string, name?: string): ModelConfig {
  return {
    id,
    model_name: id,
    display_name: id,
    description: '',
    catalog_source: 'user',
    inference_endpoint_id: 'endpoint',
    ...(name === undefined ? {} : { custom_provider_name: name }),
    capabilities: ['chat'],
    ui_visibility: ['chat'],
    inference_route: {
      api_surface: 'openai_chat_completions',
      capability_id: 'ai-sdk:openai-compatible',
      endpoint_id: 'endpoint',
      endpoint_model_id: id,
      base_url: 'https://relay.example/v1',
      auth_profile: 'bearer',
      context_window_tokens: 32_768,
      max_output_tokens: 4_096,
      input_support: { user_image: false, tool_result_image: false },
      usage: { response_usage: 'provider_reported_optional' },
      continuation: { tool_replay: 'required' },
    },
  };
}

function providerMembership(): ProviderConfigurationRegistry {
  return new ProviderConfigurationRegistry({
    load: async () => ({
      legacy_formal_provider_migration: 'completed',
      configured_providers: [
        {
          id: 'configured-formal',
          provider_definition_id: 'unknown-to-current-catalog',
          provider_connection_definition_id: 'unknown-connection',
          models: [{ model_config_id: 'formal', provider_model_id: 'formal-remote' }],
        },
      ],
      pending_model_registrations: [
        {
          id: 'registration-intent',
          configured_provider_id: 'configured-formal',
          provider_definition_id: 'unknown-to-current-catalog',
          provider_connection_definition_id: 'unknown-connection',
          inference_endpoint_id: 'endpoint',
          provider_model_id: 'recovered-remote',
          model_config_id: 'recovered',
        },
      ],
      pending_model_removals: [],
    }),
    save: vi.fn(async () => undefined),
  });
}

describe('Custom API 分组启动迁移', () => {
  it('正式 membership 恢复后按明确名称迁移剩余 user 模型，不按 route 认领正式模型', async () => {
    const models = [
      model('formal', 'Relay'),
      model('recovered', 'Relay'),
      model('custom-a', ' Relay '),
      model('custom-b', 'Relay'),
      model('unnamed'),
      { ...model('system', 'Relay'), catalog_source: 'default' as const },
    ];
    const membership = providerMembership();
    await membership.initialize({ models });
    const migrateCustomApiGroups = vi.fn(async () => undefined);

    await runCustomApiGroupMigration({
      modelCatalog: { getModels: () => models, getUserRevision: () => 7, migrateCustomApiGroups },
      providerMembership: membership,
    });

    expect(membership.getByModelConfigId('recovered')?.id).toBe('configured-formal');
    expect(migrateCustomApiGroups).toHaveBeenCalledExactlyOnceWith(
      [
        { name: 'Relay', model_ids: ['custom-a', 'custom-b'] },
        { name: '自定义模型', model_ids: ['unnamed'] },
      ],
      7
    );
  });

  it('membership 尚未初始化时失败，不把未知归属当作自定义并写入目录', async () => {
    const migrateCustomApiGroups = vi.fn(async () => undefined);
    await expect(
      runCustomApiGroupMigration({
        modelCatalog: {
          getModels: () => [model('formal')],
          getUserRevision: () => 7,
          migrateCustomApiGroups,
        },
        providerMembership: providerMembership(),
      })
    ).rejects.toThrow();
    expect(migrateCustomApiGroups).not.toHaveBeenCalled();
  });
});
