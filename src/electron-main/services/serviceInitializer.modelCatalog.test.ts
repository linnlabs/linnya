import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProviderConfigurationSnapshot } from 'src/domains/provider-configuration';
import type { ModelPickerPreferencesSnapshot } from 'src/domains/model-picker-preferences';

/**
 * 第 3 步的启动对账：Provider 归属与选择器偏好按“仍然存在的模型”清理。
 * 停用（启动时未通过准入）的用户模型还在 user_models.json 里，对账必须把它当作存在，
 * 否则它的归属与偏好会被一并删掉，之后修复或删除它时已经找不回来。
 * 这里跑真实的启动接线和两个真实注册表（内存仓库），只替换模型目录的载入与进程外设施。
 */
const stores = vi.hoisted(() => {
  const providerSnapshots: ProviderConfigurationSnapshot[] = [];
  const pickerSnapshots: ModelPickerPreferencesSnapshot[] = [];
  return {
    providerSnapshots,
    pickerSnapshots,
    providerRepository: {
      load: async (): Promise<ProviderConfigurationSnapshot> => ({
        legacy_formal_provider_migration: 'completed',
        configured_providers: [
          {
            id: 'configured-openai',
            provider_definition_id: 'openai',
            provider_connection_definition_id: 'openai-api',
            models: [
              { provider_model_id: 'gpt-a', model_config_id: 'disabled-at-startup' },
              { provider_model_id: 'gpt-b', model_config_id: 'healthy' },
              { provider_model_id: 'gpt-c', model_config_id: 'deleted-earlier' },
            ],
          },
        ],
        pending_model_registrations: [],
        pending_model_removals: [],
      }),
      save: async (snapshot: ProviderConfigurationSnapshot) => {
        providerSnapshots.push(snapshot);
      },
    },
    pickerRepository: {
      load: async (): Promise<ModelPickerPreferencesSnapshot> => ({
        provider_preferences: [],
        model_preferences: [
          { model_config_id: 'disabled-at-startup', visible: true },
          { model_config_id: 'healthy', visible: false },
          { model_config_id: 'deleted-earlier', visible: true },
        ],
      }),
      save: async (snapshot: ModelPickerPreferencesSnapshot) => {
        pickerSnapshots.push(snapshot);
      },
    },
  };
});

vi.mock('src/domains/provider-configuration', async importOriginal => {
  const actual = await importOriginal<typeof import('src/domains/provider-configuration')>();
  return {
    ...actual,
    providerConfigurationRegistry: new actual.ProviderConfigurationRegistry(
      stores.providerRepository
    ),
  };
});
vi.mock('src/domains/model-picker-preferences', async importOriginal => {
  const actual = await importOriginal<typeof import('src/domains/model-picker-preferences')>();
  return {
    ...actual,
    modelPickerPreferencesRegistry: new actual.ModelPickerPreferencesRegistry(
      stores.pickerRepository
    ),
  };
});
// 只用到模型目录更新桥接，其余 Renderer 推送与本组无关。
vi.mock('src/app-hosts/linnya/desktop-capabilities', async importOriginal => ({
  ...(await importOriginal<typeof import('src/app-hosts/linnya/desktop-capabilities')>()),
  getBackendRendererIntegrationPort: () => ({
    connectModelCatalogUpdates: async () => () => undefined,
  }),
}));

import { modelCatalog } from 'src/domains/model-catalog';
import { providerAccountRegistry } from 'src/domains/provider-account';
import { providerConfigurationRegistry } from 'src/domains/provider-configuration';
import { modelPickerPreferencesRegistry } from 'src/domains/model-picker-preferences';
import { ServiceInitializer } from './serviceInitializer';

type ModelCatalogStep = { initializeModelCatalog(): Promise<() => void> };

function runModelCatalogStep(): Promise<() => void> {
  const initializer = new ServiceInitializer(
    Object.freeze({
      pluginBootstrapScriptPath: '/test/plugin-runtime.cjs',
      ingestionScriptPath: '/test/ingestion.cjs',
      audioProcessingScriptPath: '/test/audio.cjs',
      graphExtractionScriptPath: '/test/graph-extraction.cjs',
      graphIndexingScriptPath: '/test/graph-indexing.cjs',
    }),
    Object.freeze({
      developmentRoot: '/test',
      appDataRoot: '/test',
      workspaceRoot: '/test',
      workspaceRootIsCustom: false,
    }),
    '0.0.38'
  );
  // 私有步骤是本组要驱动的边界；按名字取用，不改变生产类型。
  return (initializer as unknown as ModelCatalogStep).initializeModelCatalog();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('服务初始化第 3 步：启动对账保留停用模型的归属与偏好', () => {
  it('停用模型仍算存在；真正删掉的模型照常清理', async () => {
    vi.spyOn(providerAccountRegistry, 'initialize').mockResolvedValue(undefined);
    vi.spyOn(modelCatalog, 'installModelReasoningResolver').mockImplementation(() => undefined);
    vi.spyOn(modelCatalog, 'initialize').mockResolvedValue(undefined);
    vi.spyOn(modelCatalog, 'migrateCustomApiGroups').mockResolvedValue(undefined);
    vi.spyOn(modelCatalog, 'getModelIdentitiesIncludingUnadmitted').mockReturnValue([
      { id: 'healthy', inference_endpoint_id: 'endpoint-openai' },
      { id: 'disabled-at-startup', inference_endpoint_id: 'endpoint-openai' },
    ]);

    const disconnect = await runModelCatalogStep();
    disconnect();

    expect(
      providerConfigurationRegistry.list()[0]?.models.map(member => member.model_config_id)
    ).toEqual(['disabled-at-startup', 'healthy']);
    expect(
      modelPickerPreferencesRegistry.read().model_preferences.map(item => item.model_config_id)
    ).toEqual(['disabled-at-startup', 'healthy']);
    // 清理结果确实写回了仓库：只去掉早已删除的模型。
    expect(stores.providerSnapshots).toHaveLength(1);
    expect(stores.pickerSnapshots).toHaveLength(1);
  });
});
