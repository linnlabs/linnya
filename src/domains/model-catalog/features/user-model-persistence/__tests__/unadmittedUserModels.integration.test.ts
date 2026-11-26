import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isRecord } from '@linnya/foundation';
import { createFileCredentialStorage } from 'src/infra/adapters/credential-storage/file/createFileCredentialStorage';
import type { ModelConfig } from '../../../definitions/modelCatalog';
import type { ModelCatalogRegistry } from '../../../registry/modelCatalogRegistry';
import { createSourceDistributionIdentity } from '../../../../../shared/distribution-identity';

/**
 * 启动时停用的用户模型（未通过准入、原样留在 user_models.json 里）可以被删除、随分组删除，
 * 或由正式 Provider 按定义重建。这里走真实文件与真实凭据存储：写盘、重启、失败回滚都按用户能观察到的结果断言。
 */

const paths = vi.hoisted(() => ({ directory: '' }));
vi.mock('src/shared/utils/pathManager', () => ({
  pathManager: {
    getUserModelsConfigPath: async () => `${paths.directory}/user_models.json`,
  },
}));

const RELAY_URL = 'https://relay.example/v1';

function chatModel(id: string, endpointId: string, group?: string): ModelConfig {
  return {
    id,
    model_name: id,
    display_name: `Title ${id}`,
    description: '',
    catalog_source: 'user',
    billing_mode: 'byok',
    capabilities: ['chat'],
    ui_visibility: [],
    ...(group ? { custom_provider_name: group } : {}),
    inference_endpoint_id: endpointId,
    inference_route: {
      api_surface: 'openai_chat_completions',
      capability_id: 'ai-sdk:openai-chat',
      endpoint_id: 'fixture-endpoint',
      endpoint_model_id: id,
      base_url: RELAY_URL,
      auth_profile: 'bearer',
      context_window_tokens: 32_768,
      max_output_tokens: 4_096,
      input_support: { user_image: false, tool_result_image: false },
      usage: { response_usage: 'provider_reported_optional' },
      continuation: { tool_replay: 'required' },
    },
  };
}

function createEndpoint(id: string, secret: string) {
  return {
    kind: 'create' as const,
    endpoint: {
      id,
      route_profile_id: 'openai_chat' as const,
      endpoint_id: 'fixture-endpoint',
      base_url: RELAY_URL,
      auth_profile: 'bearer' as const,
      credential_secret: secret,
    },
  };
}

async function openRegistry(): Promise<ModelCatalogRegistry> {
  vi.resetModules();
  const { ModelCatalogRegistry } = await import('../../../registry/modelCatalogRegistry');
  const registry = ModelCatalogRegistry.getInstance();
  registry.installEndpointCredentialStorage(
    createFileCredentialStorage(path.join(paths.directory, 'credentials.json'))
  );
  await registry.initialize(createSourceDistributionIdentity());
  return registry;
}

const userModelsPath = () => path.join(paths.directory, 'user_models.json');
const credentialsPath = () => path.join(paths.directory, 'credentials.json');

async function readUserModelsFile(): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await fs.readFile(userModelsPath(), 'utf8'));
  if (!isRecord(parsed)) throw new Error('user_models.json 不是对象');
  return parsed;
}

function readArray(file: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = file[key];
  if (!Array.isArray(value)) throw new Error(`${key} 不是数组`);
  return value.filter(isRecord);
}

/** 模拟旧版本或手工修改留下的文件：直接改写磁盘内容，下次启动再经过真实准入。 */
async function editUserModelsFile(
  edit: (file: Record<string, unknown>) => Record<string, unknown>
): Promise<void> {
  await fs.writeFile(userModelsPath(), JSON.stringify(edit(await readUserModelsFile()), null, 2));
}

function fileModelIds(file: Record<string, unknown>): unknown[] {
  return readArray(file, 'models').map(model => model.id);
}

function fileEndpointIds(file: Record<string, unknown>): unknown[] {
  return readArray(file, 'inference_endpoints').map(endpoint => endpoint.id);
}

function failNextUserModelsWrite(): () => void {
  const originalRename = fs.rename;
  const spy = vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
    if (target === userModelsPath()) throw new Error('fixture disk failure');
    await originalRename(source, target);
  });
  return () => spy.mockRestore();
}

describe('启动时停用的用户模型：删除、随分组删除与按定义重建', () => {
  beforeEach(async () => {
    paths.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-unadmitted-'));
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

  it('分组内与未归类的停用条目分别可见；删除单条与删除分组都连同连接和独占 Key 一起清掉，失败不改文件', async () => {
    let catalog = await openRegistry();
    await catalog.registerCustomApiModels(
      'Relay',
      [
        {
          model: chatModel('healthy', 'endpoint-a', 'Relay'),
          endpoint: createEndpoint('endpoint-a', 'relay-key'),
        },
        {
          model: chatModel('broken', 'endpoint-a', 'Relay'),
          endpoint: { kind: 'existing', inference_endpoint_id: 'endpoint-a' },
        },
      ],
      0
    );
    await catalog.registerCustomApiModels(
      'Gone',
      [
        {
          model: chatModel('orphan', 'endpoint-b', 'Gone'),
          endpoint: createEndpoint('endpoint-b', 'gone-key'),
        },
      ],
      catalog.getUserRevision()
    );
    // 旧版删分组只删分组和已准入模型，停用条目与它的连接留在文件里，成了“未归类”。
    // broken 被改成旧版编辑接口写出的双 route；orphan 的连接仍有独占 Key。
    await editUserModelsFile(file => ({
      ...file,
      custom_api_groups: readArray(file, 'custom_api_groups').filter(
        group => group.name !== 'Gone'
      ),
      models: readArray(file, 'models').map(model =>
        model.id === 'broken' || model.id === 'orphan'
          ? {
              ...model,
              capabilities: ['chat', 'embedding'],
              embedding_route: {
                api_surface: 'openai_embeddings',
                capability_id: 'ai-sdk:openai-compatible-embeddings',
                endpoint_id: 'fixture-endpoint',
                endpoint_model_id: model.id,
                base_url: RELAY_URL,
                auth_profile: 'bearer',
                usage: { response_usage: 'provider_reported_optional' },
              },
            }
          : model
      ),
    }));

    catalog = await openRegistry();
    expect(catalog.getModel('healthy')).toBeDefined();
    expect(catalog.getUnadmittedUserModels()).toEqual([
      expect.objectContaining({
        id: 'broken',
        custom_api_group_name: 'Relay',
        display_name: 'Title broken',
        reason_kind: 'multiple_routes',
      }),
      expect.objectContaining({
        id: 'orphan',
        custom_api_group_name: undefined,
        reason_kind: 'multiple_routes',
      }),
    ]);

    // 写盘失败：文件、凭据与内存都停在删除前。
    const before = await fs.readFile(userModelsPath(), 'utf8');
    const restoreRename = failNextUserModelsWrite();
    await expect(catalog.removeModel('orphan')).rejects.toThrow('fixture disk failure');
    restoreRename();
    expect(await fs.readFile(userModelsPath(), 'utf8')).toBe(before);
    expect(catalog.getUnadmittedUserModels().map(entry => entry.id)).toEqual(['broken', 'orphan']);
    expect(catalog.resolveInferenceEndpointCredential('endpoint-b')).toBe('gone-key');

    // 删除单条停用条目：原条目、它独占的连接与 Key 同一次提交清掉，重启后仍不在。
    await catalog.removeModel('orphan');
    let file = await readUserModelsFile();
    expect(fileModelIds(file)).toEqual(['healthy', 'broken']);
    expect(fileEndpointIds(file)).toEqual(['endpoint-a']);
    expect(await fs.readFile(credentialsPath(), 'utf8')).not.toContain('endpoint-b');
    catalog = await openRegistry();
    expect(catalog.getUnadmittedUserModels().map(entry => entry.id)).toEqual(['broken']);

    // 删除分组：组里的已准入模型和停用条目一起删，最后一个引用消失后连接与 Key 回收。
    await catalog.removeCustomApiGroup('Relay', catalog.getUserRevision());
    file = await readUserModelsFile();
    expect(fileModelIds(file)).toEqual([]);
    expect(fileEndpointIds(file)).toEqual([]);
    expect(JSON.parse(await fs.readFile(credentialsPath(), 'utf8'))).toMatchObject({
      namespaces: {},
    });
    catalog = await openRegistry();
    expect(catalog.getUnadmittedUserModels()).toEqual([]);
    expect(catalog.getModel('healthy')).toBeUndefined();
  });

  it('不存在的 ID 删除报错；分组删除失败时停用条目与 Key 都保留', async () => {
    let catalog = await openRegistry();
    await catalog.registerCustomApiModels(
      'Relay',
      [
        {
          model: chatModel('broken', 'endpoint-a', 'Relay'),
          endpoint: createEndpoint('endpoint-a', 'relay-key'),
        },
      ],
      0
    );
    await editUserModelsFile(file => ({
      ...file,
      models: readArray(file, 'models').map(model => ({
        ...model,
        inference_endpoint_id: 'missing',
      })),
    }));
    catalog = await openRegistry();
    expect(catalog.getUnadmittedUserModels()).toEqual([
      expect.objectContaining({ id: 'broken', reason_kind: 'endpoint_missing' }),
    ]);
    await expect(catalog.removeModel('nobody')).rejects.toThrow('模型不存在: nobody');

    // 连接已缺失，归属规则对不上分组：它是“未归类”，删分组不会带走它。
    expect(catalog.getUnadmittedUserModels()[0]?.custom_api_group_name).toBeUndefined();
    const restoreRename = failNextUserModelsWrite();
    await expect(catalog.removeCustomApiGroup('Relay', catalog.getUserRevision())).rejects.toThrow(
      'fixture disk failure'
    );
    restoreRename();
    expect(catalog.getCustomApiGroups()).toEqual([
      { name: 'Relay', inference_endpoint_ids: ['endpoint-a'] },
    ]);
    expect(catalog.resolveInferenceEndpointCredential('endpoint-a')).toBe('relay-key');
    expect(catalog.getUnadmittedUserModels().map(entry => entry.id)).toEqual(['broken']);
  });

  it('按定义重建同 ID：替换停用条目、旧连接无人引用时回收但共用的 Key 保留，重启后正常可用', async () => {
    let catalog = await openRegistry();
    await catalog.registerUserModel(
      chatModel('member', 'endpoint-a'),
      createEndpoint('endpoint-a', 'provider-key')
    );
    // route 与连接地址对不上（例如服务地址在新版定义里变了，旧条目没跟上）。
    await editUserModelsFile(file => ({
      ...file,
      models: readArray(file, 'models').map(model => {
        const route = model.inference_route;
        return isRecord(route)
          ? { ...model, inference_route: { ...route, base_url: 'https://stale.example/v1' } }
          : model;
      }),
    }));
    catalog = await openRegistry();
    expect(catalog.getUnadmittedUserModels()).toEqual([
      expect.objectContaining({ id: 'member', reason_kind: 'route_endpoint_mismatch' }),
    ]);

    // 不能借修复入口覆盖已准入模型，也不能修复不存在的条目。
    await expect(
      catalog.replaceUnadmittedUserModel(chatModel('someone', 'endpoint-a'), {
        kind: 'existing',
        inference_endpoint_id: 'endpoint-a',
      })
    ).rejects.toThrow('停用的用户模型不存在: someone');

    // 新连接与旧连接共用同一份 Key（同一 Provider 的凭据边界）。
    const repaired = chatModel('member', 'endpoint-c');
    await catalog.replaceUnadmittedUserModel(repaired, {
      kind: 'create',
      endpoint: {
        id: 'endpoint-c',
        route_profile_id: 'openai_chat',
        endpoint_id: 'fixture-endpoint',
        base_url: RELAY_URL,
        auth_profile: 'bearer',
        credential_reference: {
          kind: 'stored_secret',
          credential_id: 'inference-endpoint:endpoint-a',
        },
      },
    });
    expect(catalog.getUnadmittedUserModels()).toEqual([]);
    expect(catalog.getModel('member')).toMatchObject({ inference_endpoint_id: 'endpoint-c' });
    const file = await readUserModelsFile();
    expect(fileModelIds(file)).toEqual(['member']);
    expect(fileEndpointIds(file)).toEqual(['endpoint-c']);

    catalog = await openRegistry();
    expect(catalog.getUnadmittedUserModels()).toEqual([]);
    expect(catalog.getModel('member')).toMatchObject({ inference_endpoint_id: 'endpoint-c' });
    expect(catalog.resolveInferenceEndpointCredential('endpoint-c')).toBe('provider-key');
    await expect(
      catalog.replaceUnadmittedUserModel(repaired, {
        kind: 'existing',
        inference_endpoint_id: 'endpoint-c',
      })
    ).rejects.toThrow('停用的用户模型不存在: member');
  });
});
