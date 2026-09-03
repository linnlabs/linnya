import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileWebReadConfigStore } from '../../../infra/adapters/web-read-config/fileWebReadConfigStore';
import { WebReadConfigurationError } from '../webread/definitions/webReadConfig';
import {
  getWebReadConfig,
  installWebReadConfigReader,
} from '../webread/ports/webReadConfigReader';

const tempRoots: string[] = [];
const testCodec = {
  encrypt: async (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf8').toString('base64'),
  decrypt: async (ciphertext: string) => Buffer.from(ciphertext, 'base64').toString('utf8').replace(/^encrypted:/u, ''),
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function createConfigPath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-web-read-config-'));
  tempRoots.push(root);
  return path.join(root, 'config', 'web_read.json');
}

describe('R3 网络读取配置持久化', () => {
  it('首次启动使用显式产品默认且不创建文件', async () => {
    const configPath = createConfigPath();
    const store = await FileWebReadConfigStore.open(configPath, testCodec);
    expect(store.read()).toEqual({ renderEnabled: true, managedReader: 'none' });
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it('两个 Reader Key 只以密文落盘，重启和切换后均可恢复', async () => {
    const configPath = createConfigPath();
    const store = await FileWebReadConfigStore.open(configPath, testCodec);
    await store.save({
      renderEnabled: true,
      managedReader: 'metaso_reader',
      byokKey: 'metaso-secret',
    });
    await store.save({
      renderEnabled: false,
      managedReader: 'jina_reader',
      byokKey: 'jina-secret',
    });
    const disk = fs.readFileSync(configPath, 'utf8');
    expect(disk).not.toContain('metaso-secret');
    expect(disk).not.toContain('jina-secret');
    expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);

    const restarted = await FileWebReadConfigStore.open(configPath, testCodec);
    expect(restarted.read()).toMatchObject({
      renderEnabled: false,
      managedReader: 'jina_reader',
      byokKey: 'jina-secret',
    });
    await restarted.save({ renderEnabled: true, managedReader: 'metaso_reader' });
    expect(restarted.read()).toMatchObject({
      managedReader: 'metaso_reader',
      byokKey: 'metaso-secret',
    });
  });

  it('损坏文件显式失败，重新保存有效配置后恢复', async () => {
    const configPath = createConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, '{broken', 'utf8');
    const store = await FileWebReadConfigStore.open(configPath, testCodec);
    expect(() => store.read()).toThrow(WebReadConfigurationError);

    await store.save({ renderEnabled: true, managedReader: 'none' });
    expect(store.read()).toEqual({ renderEnabled: true, managedReader: 'none' });
  });

  it('配置 port 安装期间读取持久化快照，卸载后恢复产品默认', async () => {
    const configPath = createConfigPath();
    const store = await FileWebReadConfigStore.open(configPath, testCodec);
    await store.save({ renderEnabled: false, managedReader: 'jina_reader', byokKey: 'jina-secret' });
    const uninstall = installWebReadConfigReader(store);
    try {
      expect(getWebReadConfig()).toMatchObject({
        renderEnabled: false,
        managedReader: 'jina_reader',
        byokKey: 'jina-secret',
      });
    } finally {
      uninstall();
    }
    expect(getWebReadConfig()).toEqual({ renderEnabled: true, managedReader: 'none' });
  });
});
