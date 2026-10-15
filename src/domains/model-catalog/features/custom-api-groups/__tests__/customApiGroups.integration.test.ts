import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EndpointCredentialCodec } from '../../../definitions/inferenceEndpoint';
import type {
  ModelCatalog,
  ModelConfig,
  UserModelRegistration,
} from '../../../definitions/modelCatalog';
import { createSourceDistributionIdentity } from '../../../../../shared/distribution-identity';

const paths = vi.hoisted(() => ({ directory: '' }));
vi.mock('src/shared/utils/pathManager', () => ({
  pathManager: {
    getUserModelsConfigPath: async () => `${paths.directory}/user_models.json`,
    getEndpointCredentialsConfigPath: () => `${paths.directory}/endpoint_credentials.json`,
  },
}));

function model(id: string, group = 'Relay'): ModelConfig {
  return {
    id,
    model_name: id,
    display_name: `User title ${id}`,
    description: 'User description',
    catalog_source: 'user',
    billing_mode: 'byok',
    capabilities: ['chat'],
    ui_visibility: [],
    custom_provider_name: group,
    inference_endpoint_id: 'endpoint-a',
    inference_route: {
      api_surface: 'openai_chat_completions',
      capability_id: 'ai-sdk:openai-chat',
      endpoint_id: 'fixture-endpoint',
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

function registration(id: string, create: boolean, group = 'Relay'): UserModelRegistration {
  return {
    model: model(id, group),
    endpoint: create
      ? {
          kind: 'create',
          endpoint: {
            id: 'endpoint-a',
            route_profile_id: 'openai_chat',
            endpoint_id: 'fixture-endpoint',
            base_url: 'https://relay.example/v1',
            auth_profile: 'bearer',
            credential_secret: 'fixture-key',
          },
        }
      : { kind: 'existing', inference_endpoint_id: 'endpoint-a' },
  };
}

const defaultCodec: EndpointCredentialCodec = {
  encrypt: async plaintext => Buffer.from(plaintext).toString('base64'),
  decrypt: async ciphertext => Buffer.from(ciphertext, 'base64').toString(),
};

async function openRegistry(codec: EndpointCredentialCodec = defaultCodec): Promise<ModelCatalog> {
  vi.resetModules();
  const { ModelCatalogRegistry } = await import('../../../registry/modelCatalogRegistry');
  const registry = ModelCatalogRegistry.getInstance();
  registry.installEndpointCredentialCodec(codec);
  await registry.initialize(createSourceDistributionIdentity());
  return registry;
}

function requiredModel(catalog: ModelCatalog, id: string): ModelConfig {
  const value = catalog.getModel(id);
  if (!value) throw new Error(`fixture model missing: ${id}`);
  return value;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise: () => void = () => {};
  const promise = new Promise<void>(resolve => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

async function readCatalogFile(): Promise<string> {
  return fs.readFile(path.join(paths.directory, 'user_models.json'), 'utf8');
}

describe('自定义 API 分组连接生命周期', () => {
  beforeEach(async () => {
    paths.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-custom-group-'));
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

  it('一次提交增删，保留已有模型用户字段；空列表重启后仍可用原连接重新刷新', async () => {
    let catalog = await openRegistry();
    await catalog.registerCustomApiModels(
      'Relay',
      [registration('keep', true), registration('remove', false)],
      0
    );
    const existing = requiredModel(catalog, 'keep');
    const rename = vi.spyOn(fs, 'rename');
    const revision = catalog.getUserRevision();
    await catalog.applyCustomApiGroupModelDiff(
      'Relay',
      {
        added: [model('new')],
        updated: [],
        removed: ['remove'],
      },
      revision
    );
    expect(catalog.getModel('keep')).toBe(existing);
    expect(catalog.getModel('remove')).toBeUndefined();
    expect(catalog.getModel('new')).toMatchObject({ display_name: 'User title new' });
    expect(catalog.getUserRevision()).toBe(revision + 1);
    expect(
      rename.mock.calls.filter(
        ([, target]) => target === path.join(paths.directory, 'user_models.json')
      )
    ).toHaveLength(1);

    await catalog.applyCustomApiGroupModelDiff(
      'Relay',
      {
        added: [],
        updated: [],
        removed: ['keep', 'new'],
      },
      catalog.getUserRevision()
    );
    expect(catalog.getCustomApiGroups()).toEqual([
      { name: 'Relay', inference_endpoint_ids: ['endpoint-a'] },
    ]);
    expect(catalog.getInferenceEndpoints()).toHaveLength(1);
    catalog = await openRegistry();
    expect(catalog.getCustomApiGroups()).toEqual([
      { name: 'Relay', inference_endpoint_ids: ['endpoint-a'] },
    ]);
    expect(catalog.resolveInferenceEndpointCredential('endpoint-a')).toBe('fixture-key');
    await catalog.applyCustomApiGroupModelDiff(
      'Relay',
      { added: [model('returned')], updated: [], removed: [] },
      catalog.getUserRevision()
    );
    expect(catalog.getModel('returned')).toMatchObject({ inference_endpoint_id: 'endpoint-a' });
    expect(await readCatalogFile()).not.toContain('fixture-key');
  });

  it('显式删除最后一个分组才回收连接，共用 endpoint 的其他分组和模型不受影响', async () => {
    const catalog = await openRegistry();
    await catalog.registerCustomApiModels('Relay', [registration('a', true)], 0);
    await catalog.registerCustomApiModels(
      'Other',
      [registration('b', false, 'Other')],
      catalog.getUserRevision()
    );
    await catalog.removeCustomApiGroup('Relay', catalog.getUserRevision());
    expect(catalog.getModel('a')).toBeUndefined();
    expect(catalog.getModel('b')).toBeDefined();
    expect(catalog.resolveInferenceEndpointCredential('endpoint-a')).toBe('fixture-key');
    await catalog.applyCustomApiGroupModelDiff(
      'Other',
      { added: [], updated: [], removed: ['b'] },
      catalog.getUserRevision()
    );
    await catalog.removeCustomApiGroup('Other', catalog.getUserRevision());
    expect(catalog.getCustomApiGroups()).toEqual([]);
    expect(catalog.getInferenceEndpoints()).toEqual([]);
    const credentials: unknown = JSON.parse(
      await fs.readFile(path.join(paths.directory, 'endpoint_credentials.json'), 'utf8')
    );
    expect(credentials).toMatchObject({ credentials: [] });
  });

  it('目录写入失败不发布增删；删除失败还原独占凭据，后续事务仍可提交', async () => {
    const catalog = await openRegistry();
    await catalog.registerCustomApiModels('Relay', [registration('old', true)], 0);
    const before = await readCatalogFile();
    const revision = catalog.getUserRevision();
    const originalRename = fs.rename;
    const rename = vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
      if (target === path.join(paths.directory, 'user_models.json'))
        throw new Error('fixture disk failure');
      await originalRename(source, target);
    });
    await expect(
      catalog.applyCustomApiGroupModelDiff(
        'Relay',
        {
          added: [model('new')],
          updated: [],
          removed: ['old'],
        },
        revision
      )
    ).rejects.toThrow('fixture disk failure');
    expect(catalog.getModel('old')).toBeDefined();
    expect(catalog.getModel('new')).toBeUndefined();
    await expect(
      catalog.rebindCustomApiGroup(
        'Relay',
        'Renamed',
        [requiredModel(catalog, 'old')],
        {
          kind: 'existing',
          inference_endpoint_id: 'endpoint-a',
          credential_secret: 'uncommitted-key',
        },
        revision
      )
    ).rejects.toThrow('fixture disk failure');
    expect(catalog.getCustomApiGroups()).toEqual([
      { name: 'Relay', inference_endpoint_ids: ['endpoint-a'] },
    ]);
    await expect(catalog.removeCustomApiGroup('Relay', revision)).rejects.toThrow(
      'fixture disk failure'
    );
    expect(catalog.getUserRevision()).toBe(revision);
    expect(catalog.resolveInferenceEndpointCredential('endpoint-a')).toBe('fixture-key');
    expect(await readCatalogFile()).toBe(before);
    rename.mockRestore();
    const restarted = await openRegistry();
    expect(restarted.resolveInferenceEndpointCredential('endpoint-a')).toBe('fixture-key');
    await catalog.removeCustomApiGroup('Relay', revision);
    expect(catalog.getCustomApiGroups()).toEqual([]);
  });

  it.each(['remove', 'replace', 'create'] as const)(
    '旧凭据不可解密时，%s 目录失败恢复原密文和不可用状态',
    async operation => {
      let catalog = await openRegistry();
      await catalog.registerCustomApiModels('Relay', [registration('a', true)], 0);
      await catalog.applyCustomApiGroupModelDiff(
        'Relay',
        {
          added: [],
          updated: [],
          removed: ['a'],
        },
        catalog.getUserRevision()
      );
      const credentialPath = path.join(paths.directory, 'endpoint_credentials.json');
      const opaqueOriginal = 'fixture-opaque-unavailable-ciphertext';
      const originalCredential = {
        id: 'inference-endpoint:endpoint-a',
        encrypted_secret: opaqueOriginal,
      };
      await fs.writeFile(
        credentialPath,
        JSON.stringify({
          version: '1.0.0',
          last_updated: '2026-10-15T00:00:00.000Z',
          credentials: [originalCredential],
        })
      );
      const encrypt = vi.fn(defaultCodec.encrypt);
      const decrypt = vi.fn(async (ciphertext: string) => {
        if (ciphertext === opaqueOriginal) throw new Error('fixture inaccessible old key');
        return defaultCodec.decrypt(ciphertext);
      });
      const codec: EndpointCredentialCodec = { encrypt, decrypt };
      catalog = await openRegistry(codec);
      const before = await readCatalogFile();
      const revision = catalog.getUserRevision();
      expect(catalog.getInferenceEndpoints()).toEqual([
        expect.objectContaining({ id: 'endpoint-a', credential_status: 'unavailable' }),
      ]);
      const originalRename = fs.rename;
      const rename = vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
        if (target === path.join(paths.directory, 'user_models.json'))
          throw new Error('fixture disk failure');
        await originalRename(source, target);
      });
      const mutation =
        operation === 'remove'
          ? catalog.removeCustomApiGroup('Relay', revision)
          : catalog.rebindCustomApiGroup(
              'Relay',
              'Relay',
              [],
              operation === 'replace'
                ? {
                    kind: 'existing',
                    inference_endpoint_id: 'endpoint-a',
                    credential_secret: 'new-key',
                  }
                : {
                    kind: 'create',
                    endpoint: {
                      id: 'endpoint-b',
                      route_profile_id: 'openai_chat',
                      endpoint_id: 'new-fixture-endpoint',
                      base_url: 'https://relay.example/v1',
                      auth_profile: 'bearer',
                      credential_secret: 'new-key',
                      credential_reference: {
                        kind: 'stored_secret',
                        credential_id: originalCredential.id,
                      },
                    },
                  },
              revision
            );
      await expect(mutation).rejects.toThrow('fixture disk failure');
      expect(catalog.getUserRevision()).toBe(revision);
      expect(await readCatalogFile()).toBe(before);
      expect(JSON.parse(await fs.readFile(credentialPath, 'utf8'))).toMatchObject({
        credentials: [originalCredential],
      });
      expect(catalog.getInferenceEndpoints()).toEqual([
        expect.objectContaining({ id: 'endpoint-a', credential_status: 'unavailable' }),
      ]);
      expect(() => catalog.resolveInferenceEndpointCredential('endpoint-a')).toThrowError(
        expect.objectContaining({ code: 'invalidated' })
      );
      // 撤回直接恢复原记录与缓存；不能要求不可用的旧 Key 再次参与加解密。
      expect(encrypt).toHaveBeenCalledTimes(operation === 'remove' ? 0 : 1);
      expect(decrypt).toHaveBeenCalledOnce();
      rename.mockRestore();
      const restarted = await openRegistry(codec);
      expect(restarted.getCustomApiGroups()).toEqual([
        { name: 'Relay', inference_endpoint_ids: ['endpoint-a'] },
      ]);
      expect(restarted.getInferenceEndpoints()[0]?.credential_status).toBe('unavailable');
      expect(() => restarted.resolveInferenceEndpointCredential('endpoint-a')).toThrowError(
        expect.objectContaining({ code: 'invalidated' })
      );
    }
  );

  it('版本冲突拒绝旧远端快照，包括空 diff；空分组可改名和换 Key', async () => {
    const catalog = await openRegistry();
    await catalog.registerCustomApiModels('Relay', [registration('a', true)], 0);
    const revision = catalog.getUserRevision();
    await catalog.applyCustomApiGroupModelDiff(
      'Relay',
      { added: [], updated: [], removed: ['a'] },
      revision
    );
    await expect(
      catalog.applyCustomApiGroupModelDiff(
        'Relay',
        { added: [], updated: [], removed: [] },
        revision
      )
    ).rejects.toThrow('模型配置已发生变化');
    await catalog.rebindCustomApiGroup(
      'Relay',
      'Renamed',
      [],
      {
        kind: 'existing',
        inference_endpoint_id: 'endpoint-a',
        credential_secret: 'replacement-key',
      },
      catalog.getUserRevision()
    );
    const restarted = await openRegistry();
    expect(restarted.getCustomApiGroups()).toEqual([
      { name: 'Renamed', inference_endpoint_ids: ['endpoint-a'] },
    ]);
    expect(restarted.resolveInferenceEndpointCredential('endpoint-a')).toBe('replacement-key');
  });

  it('明确的 App membership 迁移补齐未命名模型，重复执行不写盘且保留空分组', async () => {
    const catalog = await openRegistry();
    await catalog.registerCustomApiModels('Empty', [registration('removed', true, 'Empty')], 0);
    await catalog.applyCustomApiGroupModelDiff(
      'Empty',
      { added: [], updated: [], removed: ['removed'] },
      catalog.getUserRevision()
    );
    const unnamed = { ...model('legacy'), custom_provider_name: undefined };
    await catalog.registerUserModels(
      [{ model: unnamed, endpoint: { kind: 'existing', inference_endpoint_id: 'endpoint-a' } }],
      catalog.getUserRevision()
    );
    await catalog.migrateCustomApiGroups(
      [{ name: '自定义模型', model_ids: ['legacy'] }],
      catalog.getUserRevision()
    );
    expect(catalog.getModel('legacy')?.custom_provider_name).toBe('自定义模型');
    expect(catalog.getCustomApiGroups().map(group => group.name)).toEqual(['Empty', '自定义模型']);
    const before = await readCatalogFile();
    const revision = catalog.getUserRevision();
    const rename = vi.spyOn(fs, 'rename');
    await catalog.migrateCustomApiGroups([{ name: '自定义模型', model_ids: ['legacy'] }], revision);
    expect(catalog.getUserRevision()).toBe(revision);
    expect(rename).not.toHaveBeenCalled();
    expect(await readCatalogFile()).toBe(before);
  });

  it('凭据准备期间更新的账号投影不会被用户目录提交覆盖', async () => {
    const catalog = await openRegistry();
    const encryptionStarted = deferred();
    const encryptionRelease = deferred();
    catalog.installEndpointCredentialCodec({
      encrypt: async plaintext => {
        encryptionStarted.resolve();
        await encryptionRelease.promise;
        return Buffer.from(plaintext).toString('base64');
      },
      decrypt: async ciphertext => Buffer.from(ciphertext, 'base64').toString(),
    });
    const registration = catalog.registerCustomApiModels(
      'Relay',
      [
        {
          model: model('new'),
          endpoint: {
            kind: 'create',
            endpoint: {
              id: 'endpoint-a',
              route_profile_id: 'openai_chat',
              endpoint_id: 'fixture-endpoint',
              base_url: 'https://relay.example/v1',
              auth_profile: 'bearer',
              credential_secret: 'fixture-key',
            },
          },
        },
      ],
      0
    );
    await encryptionStarted.promise;
    catalog.replaceAccountModels('account-a', [
      {
        ...model('account-new'),
        catalog_source: 'account',
        inference_endpoint_id: undefined,
        custom_provider_name: undefined,
        credential_reference: { kind: 'provider_account', account_id: 'account-a' },
      },
    ]);
    encryptionRelease.resolve();
    await registration;
    expect(catalog.getModel('new')).toBeDefined();
    expect(catalog.getModel('account-new')).toMatchObject({ catalog_source: 'account' });
    expect(await readCatalogFile()).not.toContain('account-new');
  });

  it('v4 显式命名记录在准入后迁移一次，未知版本与损坏引用不被覆盖', async () => {
    let catalog = await openRegistry();
    await catalog.registerCustomApiModels('Relay', [registration('legacy', true)], 0);
    const file: unknown = JSON.parse(await readCatalogFile());
    if (typeof file !== 'object' || file === null) throw new Error('fixture envelope');
    Reflect.set(file, 'version', '4.0.0');
    Reflect.deleteProperty(file, 'custom_api_groups');
    await fs.writeFile(path.join(paths.directory, 'user_models.json'), JSON.stringify(file));
    catalog = await openRegistry();
    expect(catalog.getCustomApiGroups()).toEqual([
      { name: 'Relay', inference_endpoint_ids: ['endpoint-a'] },
    ]);
    expect(JSON.parse(await readCatalogFile())).toMatchObject({ version: '5.0.0' });
    const rename = vi.spyOn(fs, 'rename');
    await openRegistry();
    expect(rename).not.toHaveBeenCalled();
    const invalid = JSON.stringify({
      version: '4.0.0',
      last_updated: '2026-10-15',
      inference_endpoints: [],
      models: [model('broken')],
    });
    await fs.writeFile(path.join(paths.directory, 'user_models.json'), invalid);
    await expect(openRegistry()).rejects.toThrow('不存在的 InferenceEndpoint');
    expect(await readCatalogFile()).toBe(invalid);
  });
});
