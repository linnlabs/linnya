import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CustomCapabilityModelCommandSchema,
  type CustomCapabilityApiFormat,
} from '@app/schemas/custom-api-onboarding';
import type { ModelCatalog } from 'src/domains/model-catalog';

const state = vi.hoisted(() => ({ directory: '' }));
vi.mock('src/shared/utils/pathManager', () => ({
  pathManager: {
    getUserModelsConfigPath: async () => path.join(state.directory, 'user_models.json'),
  },
}));

async function open() {
  vi.resetModules();
  const [
    { ModelCatalogRegistry },
    { createFileCredentialStorage },
    { createCustomApiOnboardingUseCase },
    { ModelDiscoveryService },
  ] = await Promise.all([
    import('src/domains/model-catalog/registry/modelCatalogRegistry'),
    import('src/infra/adapters/credential-storage/file/createFileCredentialStorage'),
    import('./createCustomApiOnboardingUseCase'),
    import('src/domains/model-catalog'),
  ]);
  const catalog = ModelCatalogRegistry.getInstance();
  catalog.installEndpointCredentialStorage(
    createFileCredentialStorage(path.join(state.directory, 'credentials.json'))
  );
  await catalog.initialize();
  const useCase = createCustomApiOnboardingUseCase({
    modelCatalog: catalog,
    providerMembership: { getByModelConfigId: () => undefined },
    modelPickerPreferences: { async removeModelPreferences() {}, async setModelVisibilities() {} },
    modelDiscovery: new ModelDiscoveryService(),
    idFactory: { create: randomUUID },
  });
  return { catalog, useCase };
}

function command(format: CustomCapabilityApiFormat, group = format) {
  return CustomCapabilityModelCommandSchema.parse({
    api_format: format,
    provider_name: group,
    base_url: 'https://fixture.example/v1',
    api_key: 'fixture-private-key',
    endpoint_model_id: 'fixture-model',
    ...(format.startsWith('paddle_') ? { ocr_mode: 'document_upload' } : {}),
  });
}
function model(catalog: ModelCatalog, id: string | undefined) {
  if (!id) throw new Error('Registration did not return an id');
  const model = catalog.getModel(id);
  if (!model) throw new Error('Registered model missing');
  return model;
}

beforeEach(async () => {
  state.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-capability-catalog-'));
  vi.stubEnv(
    'MODEL_REGISTRY_DEFAULTS_PATH',
    path.resolve('src/domains/model-catalog/features/default-catalog/assets/default_models.json')
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(state.directory, { recursive: true, force: true });
});

describe('自定义能力模型持久化、连接归属和重启', () => {
  it('五种接口保存后重启保留真实route与独立凭据，目录不含明文Key', async () => {
    let { catalog, useCase } = await open();
    const ids: string[] = [];
    for (const format of [
      'openai_embeddings',
      'cohere_rerank',
      'openai_images_generations',
      'paddle_layout_parsing',
      'paddle_ocr_jobs',
    ] as const) {
      const result = await useCase.registerCapabilityModel(command(format));
      ids.push(model(catalog, result.model_id).id);
    }
    expect(await fs.readFile(path.join(state.directory, 'user_models.json'), 'utf8')).not.toContain(
      'fixture-private-key'
    );
    ({ catalog, useCase } = await open());
    expect(catalog.getCustomApiGroups()).toHaveLength(5);
    for (const id of ids) {
      const saved = model(catalog, id);
      expect(saved.inference_route).toBeUndefined();
      expect(saved.inference_endpoint_id).toBeTruthy();
      expect(catalog.resolveCredential(id)).toBe('fixture-private-key');
    }
    expect(model(catalog, ids[0]).embedding_route?.api_surface).toBe('openai_embeddings');
    expect(model(catalog, ids[1]).reranking_route?.api_surface).toBe('cohere_rerank');
    expect(model(catalog, ids[2]).image_generation_route?.api_surface).toBe(
      'openai_images_generations'
    );
    expect(model(catalog, ids[3]).document_ocr_route?.auth_profile).toBe('token');
    expect(model(catalog, ids[4]).document_ocr_route?.auth_profile).toBe('bearer');
    const beforeRefresh = catalog.getModels().map(model => model.id);
    await expect(useCase.refreshProvider({ provider_name: 'openai_embeddings' })).rejects.toThrow();
    expect(catalog.getModels().map(model => model.id)).toEqual(beforeRefresh);
  });

  it('删除后同名重新注册生成新身份，不重新绑定旧索引；混用其他协议不会部分保存', async () => {
    const { catalog, useCase } = await open();
    const request = command('openai_embeddings');
    const first = await useCase.registerCapabilityModel(request);
    await expect(
      useCase.registerCapabilityModel(command('cohere_rerank', 'openai_embeddings'))
    ).rejects.toThrow('其他接口格式');
    expect(catalog.getCustomApiGroups()).toHaveLength(1);
    await useCase.removeProvider({ provider_name: request.provider_name });
    expect(catalog.getInferenceEndpoints()).toHaveLength(0);
    const second = await useCase.registerCapabilityModel(request);
    expect(second.model_id).not.toBe(first.model_id);
    expect(catalog.getModel(first.model_id ?? '')).toBeUndefined();
  });

  it('本地免密与鉴权端点同组时，显式新Key统一连接；不静默猜测凭据', async () => {
    const { catalog, useCase } = await open();
    const request = command('openai_embeddings');
    const first = await useCase.registerCapabilityModel({ ...request, api_key: undefined });
    const second = await useCase.registerCapabilityModel({
      ...request,
      endpoint_model_id: 'second',
    });
    const edit = {
      current_provider_name: request.provider_name,
      provider_name: request.provider_name,
      base_url: request.base_url,
    };
    await expect(useCase.updateCapabilityProvider(edit)).rejects.toThrow('统一的 API Key');
    await useCase.updateCapabilityProvider({ ...edit, api_key: 'unified-key' });
    expect(catalog.getInferenceEndpoints()).toHaveLength(1);
    for (const id of [first.model_id, second.model_id]) {
      const updated = model(catalog, id);
      expect(updated.embedding_route?.auth_profile).toBe('bearer');
      expect(catalog.resolveCredential(updated.id)).toBe('unified-key');
    }
  });

  it('连接编辑保留模型身份和能力，改地址与Key后重启只使用新连接', async () => {
    let { catalog, useCase } = await open();
    const first = await useCase.registerCapabilityModel(command('cohere_rerank'));
    const endpointBefore = model(catalog, first.model_id).inference_endpoint_id;
    await useCase.updateCapabilityProvider({
      current_provider_name: 'cohere_rerank',
      provider_name: 'My reranker',
      base_url: 'https://other.example/v2',
      api_key: 'replacement-key',
    });
    ({ catalog } = await open());
    const saved = model(catalog, first.model_id);
    expect(saved.capabilities).toEqual(['rerank']);
    expect(saved.reranking_route?.base_url).toBe('https://other.example/v2');
    expect(saved.reranking_route?.endpoint_model_id).toBe('fixture-model');
    expect(saved.inference_endpoint_id).not.toBe(endpointBefore);
    expect(catalog.getInferenceEndpoints()).toHaveLength(1);
    expect(catalog.resolveCredential(saved.id)).toBe('replacement-key');
  });
});
