import { describe, expect, it } from 'vitest';

import {
  migrateProviderConfigurationFileV1,
  migrateProviderConfigurationFileV2,
  PROVIDER_CONFIGURATION_FILE_VERSION,
  readProviderConfigurationFile,
} from './providerConfigurationFile';

describe('provider configuration persistence migration', () => {
  it('把旧单 endpoint Provider 无损迁移为只保存模型归属的当前结构', () => {
    const migrated = migrateProviderConfigurationFileV1({
      version: '1.0.0',
      last_updated: '2026-08-20T00:00:00.000Z',
      legacy_formal_provider_migration: 'completed',
      configured_providers: [
        {
          id: 'configured-openai',
          provider_definition_id: 'openai',
          inference_endpoint_id: 'openai-endpoint',
          models: [
            { provider_model_id: 'gpt-a', model_config_id: 'model-a' },
            { provider_model_id: 'gpt-b', model_config_id: 'model-b' },
          ],
        },
      ],
      pending_model_registrations: [],
      pending_model_removals: [],
    });

    expect(migrated).toEqual({
      legacy_formal_provider_migration: 'completed',
      configured_providers: [
        {
          id: 'configured-openai',
          provider_definition_id: 'openai',
          provider_connection_definition_id: 'openai-api',
          models: [
            { provider_model_id: 'gpt-a', model_config_id: 'model-a' },
            { provider_model_id: 'gpt-b', model_config_id: 'model-b' },
          ],
        },
      ],
      pending_model_registrations: [],
      pending_model_removals: [],
    });
    expect(
      readProviderConfigurationFile({
        version: PROVIDER_CONFIGURATION_FILE_VERSION,
        last_updated: '2026-08-21T00:00:00.000Z',
        ...migrated,
      })
    ).toEqual(migrated);
  });

  it('把 OpenAI API 与 ChatGPT 订阅迁移为同品牌下互不覆盖的两个 connection', () => {
    const migrated = migrateProviderConfigurationFileV2({
      version: '2.0.0',
      last_updated: '2026-08-27T00:00:00.000Z',
      legacy_formal_provider_migration: 'completed',
      configured_providers: [
        {
          id: 'configured-openai',
          provider_definition_id: 'openai',
          models: [{ provider_model_id: 'gpt-api', model_config_id: 'model-api' }],
        },
        {
          id: 'configured-chatgpt',
          provider_definition_id: 'chatgpt',
          models: [{ provider_model_id: 'gpt-sub', model_config_id: 'model-sub' }],
        },
      ],
      pending_model_registrations: [],
      pending_model_removals: [],
    });

    expect(migrated?.configured_providers).toEqual([
      expect.objectContaining({
        id: 'configured-openai',
        provider_definition_id: 'openai',
        provider_connection_definition_id: 'openai-api',
      }),
      expect.objectContaining({
        id: 'configured-chatgpt',
        provider_definition_id: 'openai',
        provider_connection_definition_id: 'openai-chatgpt-subscription',
      }),
    ]);
  });
});
