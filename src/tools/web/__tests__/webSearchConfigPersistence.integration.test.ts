import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileWebSearchConfigStore } from '../../../infra/adapters/web-search-config/fileWebSearchConfigStore';
import { toWebSearchConfigView } from '../websearch/functions/normalizeWebSearchConfig';
import { installWebSearchConfigReader } from '../websearch/ports/webSearchConfigReader';
import { createWebSearchProvider } from '../websearch/providers/factory';

const testCodec = {
  encrypt: async (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf8').toString('base64'),
  decrypt: async (ciphertext: string) => Buffer.from(ciphertext, 'base64').toString('utf8').replace(/^encrypted:/u, ''),
};

describe('Web Search 配置保存与重启恢复', () => {
  let tempRoot: string;
  let configPath: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-web-search-config-'));
    configPath = path.join(tempRoot, 'config', 'web_search.json');
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('BYOK Key 只以密文落盘，重启恢复后 get 视图仍只返回掩码状态', async () => {
    const store = await FileWebSearchConfigStore.open(configPath, testCodec);
    await store.save({ engine: 'serper', keySource: 'byok', byokKey: 'private-serper-key' });
    expect(fs.readFileSync(configPath, 'utf8')).not.toContain('private-serper-key');

    const restarted = await FileWebSearchConfigStore.open(configPath, testCodec);
    expect(restarted.read()).toMatchObject({
      engine: 'serper',
      keySource: 'byok',
      byokKey: 'private-serper-key',
    });
    expect(toWebSearchConfigView(restarted.readSettings())).toEqual({
      engine: 'serper',
      engines: {
        parallel_free: { keySource: 'none', hasByokKey: false },
        serper: { keySource: 'byok', hasByokKey: true },
      },
    });

    await restarted.save({ engine: 'serper', keySource: 'byok' });
    expect(restarted.read().byokKey).toBe('private-serper-key');
  });

  it('多个引擎分别保存凭证，重启和来回切换都不会互相覆盖', async () => {
    const store = await FileWebSearchConfigStore.open(configPath, testCodec);
    await store.save({ engine: 'serper', keySource: 'byok', byokKey: 'serper-key' });
    await store.save({ engine: 'tavily', keySource: 'byok', byokKey: 'tavily-key' });

    const restarted = await FileWebSearchConfigStore.open(configPath, testCodec);
    expect(restarted.read()).toMatchObject({ engine: 'tavily', byokKey: 'tavily-key' });
    await restarted.save({ engine: 'serper', keySource: 'byok' });
    expect(restarted.read()).toMatchObject({ engine: 'serper', byokKey: 'serper-key' });
    expect(fs.readFileSync(configPath, 'utf8')).not.toContain('serper-key');
    expect(fs.readFileSync(configPath, 'utf8')).not.toContain('tavily-key');
  });

  it('旧版本配置明确失败，不保留 Cloud 搜索兼容读取', async () => {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      version: 2,
      settings: {
        engine: 'serper',
        slots: { serper: { keySource: 'cloud' } },
      },
    }));

    const rejected = await FileWebSearchConfigStore.open(configPath, testCodec);
    expect(() => rejected.read()).toThrow(/文件结构或版本不受支持/u);
  });

  it('保存 BYOK 后，重启实例通过配置 port 创建唯一搜索服务', async () => {
    const store = await FileWebSearchConfigStore.open(configPath, testCodec);
    await store.save({
      engine: 'serper',
      keySource: 'byok',
      byokKey: 'saved-serper-key',
    });
    const restarted = await FileWebSearchConfigStore.open(configPath, testCodec);
    const uninstall = installWebSearchConfigReader(restarted);
    try {
      expect(createWebSearchProvider(undefined, { environment: {} }).name).toBe('serper');
    } finally {
      uninstall();
    }
  });
});
