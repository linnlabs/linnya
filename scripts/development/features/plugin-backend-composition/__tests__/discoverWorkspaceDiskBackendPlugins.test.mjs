import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { discoverWorkspaceDiskBackendPlugins } from '../functions/discoverWorkspaceDiskBackendPlugins.mjs';

const tempRoots = [];

function createPlugin(repositoryRoot, directoryName, pluginId, backendLoading) {
  const packageDir = path.join(repositoryRoot, 'packages/plugins', directoryName);
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(path.join(packageDir, 'plugin.json'), `${JSON.stringify({ id: pluginId })}\n`);
  fs.writeFileSync(path.join(packageDir, 'package.json'), `${JSON.stringify({
    name: `@plugin/${pluginId}`,
    ...(backendLoading === undefined ? {} : {
      linnya: { development: { backendLoading } },
    }),
  })}\n`);
  return packageDir;
}

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe('workspace disk backend plugin discovery', () => {
  it('只发现由插件 owner 显式选择 disk 开发装配的 package', () => {
    const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-plugin-composition-'));
    tempRoots.push(repositoryRoot);
    const diskPluginDir = createPlugin(repositoryRoot, 'private-plugin', 'private-plugin', 'disk');
    createPlugin(repositoryRoot, 'inline-plugin', 'inline-plugin');

    expect(discoverWorkspaceDiskBackendPlugins(repositoryRoot)).toEqual([{
      pluginId: 'private-plugin',
      packageDir: diskPluginDir,
    }]);
  });

  it('拒绝悄悄接受未知 backend 装配模式', () => {
    const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-plugin-composition-'));
    tempRoots.push(repositoryRoot);
    createPlugin(repositoryRoot, 'invalid-plugin', 'invalid-plugin', 'inline');

    expect(() => discoverWorkspaceDiskBackendPlugins(repositoryRoot))
      .toThrow('linnya.development.backendLoading 只允许 disk');
  });
});
