import { createFileCredentialStorage } from '../../../infra/adapters/credential-storage/file/createFileCredentialStorage';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileWebReadConfigStore } from '../../../infra/adapters/web-read-config/fileWebReadConfigStore';
import {
  getWebReadConfig,
  installWebReadConfigReader,
} from '../webread/ports/webReadConfigReader';

const tempRoots: string[] = [];
function credentialPath(configPath: string): string {
  return path.join(path.dirname(configPath), 'credentials.json');
}
function storage(configPath: string) {
  return createFileCredentialStorage(credentialPath(configPath));
}


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
    const store = await FileWebReadConfigStore.open(configPath, storage(configPath));
    expect(store.read()).toEqual({ renderEnabled: true, managedReader: 'none' });
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it('两个 Reader Key 保存在统一凭据文件，重启和切换后均可恢复', async () => {
    const configPath = createConfigPath();
    const store = await FileWebReadConfigStore.open(configPath, storage(configPath));
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
    const disk = fs.readFileSync(credentialPath(configPath), 'utf8');
    expect(disk).toContain('metaso-secret');
    expect(disk).toContain('jina-secret');
    expect(fs.statSync(credentialPath(configPath)).mode & 0o777).toBe(0o600);

    const restarted = await FileWebReadConfigStore.open(configPath, storage(configPath));
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

  it('运行中的凭据文件损坏后拒绝保存，不能用默认设置覆盖原件', async () => {
    const configPath = createConfigPath();
    const store = await FileWebReadConfigStore.open(configPath, storage(configPath));
    await store.save({ renderEnabled: false, managedReader: 'jina_reader', byokKey: 'secret' });
    fs.writeFileSync(credentialPath(configPath), '{broken');
    expect(() => store.read()).toThrow('保留原文件');
    await expect(store.save({ renderEnabled: true, managedReader: 'none' })).rejects.toThrow('保留原文件');
    expect(fs.readFileSync(credentialPath(configPath), 'utf8')).toBe('{broken');
  });

  it('配置 port 安装期间读取持久化快照，卸载后恢复产品默认', async () => {
    const configPath = createConfigPath();
    const store = await FileWebReadConfigStore.open(configPath, storage(configPath));
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
