import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  prependPluginCliLauncherPath,
  reconcilePluginCliLaunchers,
  resolvePluginCliLauncherFileName,
} from '..';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fsp.rm(root, {
    recursive: true,
    force: true,
  })));
});

async function createRoot(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-plugin-cli-launcher-'));
  roots.push(root);
  return root;
}

describe('Plugin CLI launcher reconcile', () => {
  it('只生成绑定 plugin id 的 client facade，并精准移除 manifest 管理的 stale 文件', async () => {
    const root = await createRoot();
    const directory = path.join(root, 'CommandRuntimes', 'v2', 'bin');
    const clientExecutablePath = path.join(root, 'linnya-plugin-cli-client');
    await fsp.writeFile(clientExecutablePath, Buffer.from('thin-client-v1'));

    const installed = await reconcilePluginCliLaunchers({
      directory,
      clientExecutablePath,
      enabledPluginIds: ['slides', 'fake-plugin'],
      knownPluginIds: ['slides', 'fake-plugin'],
    });
    expect(installed.map(item => item.commandName)).toEqual([
      'linnya-fake-plugin',
      'linnya-slides',
    ]);
    await expect(fsp.readFile(path.join(directory, resolvePluginCliLauncherFileName('slides'))))
      .resolves.toEqual(Buffer.from('thin-client-v1'));
    const unmanagedPath = path.join(directory, 'user-command');
    await fsp.writeFile(unmanagedPath, 'keep');

    await reconcilePluginCliLaunchers({
      directory,
      clientExecutablePath,
      enabledPluginIds: ['slides'],
      knownPluginIds: ['slides', 'fake-plugin'],
    });
    await expect(fsp.stat(path.join(directory, resolvePluginCliLauncherFileName('fake-plugin'))))
      .rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fsp.readFile(unmanagedPath, 'utf8')).resolves.toBe('keep');
  });

  it('精准清理会启动 Electron 的 v1 facade，不递归删除旧目录中的未知文件', async () => {
    const root = await createRoot();
    const directory = path.join(root, 'CommandRuntimes', 'v2', 'bin');
    const legacyDirectory = path.join(root, 'CommandRuntimes', 'v1', 'bin');
    const clientExecutablePath = path.join(root, 'linnya-plugin-cli-client');
    await fsp.mkdir(legacyDirectory, { recursive: true });
    await fsp.writeFile(clientExecutablePath, 'thin-client-v2');
    await fsp.writeFile(path.join(legacyDirectory, 'linnya-slides'), 'exec Electron');
    await fsp.writeFile(path.join(legacyDirectory, 'unmanaged-command'), 'keep');

    await reconcilePluginCliLaunchers({
      directory,
      clientExecutablePath,
      enabledPluginIds: ['slides'],
      knownPluginIds: ['slides'],
      legacyDirectories: [legacyDirectory],
    });

    await expect(fsp.stat(path.join(legacyDirectory, 'linnya-slides')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fsp.readFile(path.join(legacyDirectory, 'unmanaged-command'), 'utf8'))
      .resolves.toBe('keep');
  });

  it('在用户 PATH 前只加入当前受管目录，并保留原始 key 大小写', () => {
    const directory = path.resolve('/tmp/linnya cli/bin');
    expect(prependPluginCliLauncherPath({ Path: '/usr/bin:/bin' }, directory)).toEqual({
      Path: `${directory}${path.delimiter}/usr/bin:/bin`,
    });
  });
});
