import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { installRuntimePathRoots } from 'src/shared/runtime-paths';
import { readProviderConnectionLookup } from '../../../index';
import type { ProviderConfigurationSnapshot } from '../../../definitions/providerConfiguration';

const snapshot: ProviderConfigurationSnapshot = {
  legacy_formal_provider_migration: 'completed',
  configured_providers: [
    {
      id: 'configured-go',
      provider_definition_id: 'opencode',
      provider_connection_definition_id: 'opencode-go',
      models: [{ provider_model_id: 'deepseek-v4.1-flash', model_config_id: 'model-go' }],
    },
    {
      id: 'configured-zen',
      provider_definition_id: 'opencode',
      provider_connection_definition_id: 'opencode-zen',
      models: [{ provider_model_id: 'deepseek-v4.1-flash', model_config_id: 'model-zen' }],
    },
  ],
  pending_model_registrations: [
    {
      id: 'pending-registration',
      configured_provider_id: 'configured-go',
      provider_definition_id: 'opencode',
      provider_connection_definition_id: 'opencode-go',
      inference_endpoint_id: 'endpoint-go',
      provider_model_id: 'pending-provider-model',
      model_config_id: 'pending-model',
    },
  ],
  pending_model_removals: [{ id: 'pending-removal', model_config_id: 'model-zen' }],
};

function fileContent(version = '3.0.0'): string {
  return JSON.stringify({ version, last_updated: '2026-10-19T00:00:00.000Z', ...snapshot });
}

describe('Worker 只读 Provider 模型归属', () => {
  let temporaryRoot = '';
  let modelsDirectory = '';
  let filePath = '';

  beforeAll(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-provider-readonly-'));
    modelsDirectory = path.join(temporaryRoot, 'Models');
    filePath = path.join(modelsDirectory, 'provider_configurations.json');
    installRuntimePathRoots({
      developmentRoot: temporaryRoot,
      appDataRoot: path.join(temporaryRoot, 'app-data'),
      workspaceRoot: temporaryRoot,
      workspaceRootIsCustom: true,
    });
  });

  beforeEach(async () => {
    await fs.rm(modelsDirectory, { recursive: true, force: true });
  });

  afterAll(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  it('冻结已提交 connection 归属，不恢复注册或删除 intent，也不改写配置', async () => {
    await fs.mkdir(modelsDirectory);
    const content = fileContent();
    await fs.writeFile(filePath, content, 'utf8');
    const before = await fs.stat(filePath, { bigint: true });

    const lookup = await readProviderConnectionLookup();
    expect(lookup('model-go')).toBe('opencode-go');
    expect(lookup('model-zen')).toBe('opencode-zen');
    expect(lookup('custom-api-model')).toBeUndefined();
    expect(lookup('pending-model')).toBeUndefined();
    expect(await fs.readFile(filePath, 'utf8')).toBe(content);
    expect((await fs.stat(filePath, { bigint: true })).mtimeNs).toBe(before.mtimeNs);
    expect(await fs.readdir(modelsDirectory)).toEqual(['provider_configurations.json']);

    await fs.writeFile(filePath, fileContent().replace('opencode-go', 'changed-connection'), 'utf8');
    expect(lookup('model-go')).toBe('opencode-go');
  });

  it('启动 owner 尚未生成配置时直接失败，不创建 Models 目录或默认文件', async () => {
    await expect(readProviderConnectionLookup()).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readdir(temporaryRoot)).toEqual([]);
  });

  it.each(['1.0.0', '2.0.0', '4.0.0'])('拒绝版本 %s，不能在 Worker 迁移或覆盖文件', async version => {
    await fs.mkdir(modelsDirectory);
    const content = fileContent(version);
    await fs.writeFile(filePath, content, 'utf8');

    await expect(readProviderConnectionLookup()).rejects.toThrow('version 必须是 3.0.0');
    expect(await fs.readFile(filePath, 'utf8')).toBe(content);
  });

  it('损坏配置和重复模型归属直接失败，不能静默选择另一条 connection', async () => {
    await fs.mkdir(modelsDirectory);
    await fs.writeFile(filePath, '{', 'utf8');
    await expect(readProviderConnectionLookup()).rejects.toBeInstanceOf(SyntaxError);
    expect(await fs.readFile(filePath, 'utf8')).toBe('{');

    const duplicate = fileContent().replace(/model-zen/gu, 'model-go');
    await fs.writeFile(filePath, duplicate, 'utf8');
    await expect(readProviderConnectionLookup()).rejects.toThrow(
      'ModelConfig 已关联多个正式 Provider: model-go'
    );
    expect(await fs.readFile(filePath, 'utf8')).toBe(duplicate);
  });
});
