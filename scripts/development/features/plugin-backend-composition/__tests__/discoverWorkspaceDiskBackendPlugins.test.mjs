import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createElectronDevelopmentBuilds } from '../../build-session/definitions/electronDevelopmentBuilds.mjs';
import { runDevelopmentBuildGraph } from '../../build-session/orchestration/runDevelopmentBuildGraph.mjs';
import { discoverWorkspaceDiskBackendPlugins } from '../functions/discoverWorkspaceDiskBackendPlugins.mjs';

const tempRoots = [];

function createPlugin(repositoryRoot, directoryName, pluginId, backendLoading) {
  const packageDir = path.join(repositoryRoot, 'packages/plugins', directoryName);
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(path.join(packageDir, 'plugin.json'), `${JSON.stringify({ id: pluginId })}\n`);
  fs.writeFileSync(path.join(packageDir, 'package.json'), `${JSON.stringify({
    name: `@plugin/${pluginId}`,
    ...(backendLoading === undefined ? {} : {
      linnya: { development: { backendLoading, backendWatchConfig: 'tsup.plugin.config.ts' } },
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
      backendWatchConfig: 'tsup.plugin.config.ts',
    }]);
  });

  it('发现附加Worker后，Desktop等待本轮所有产物，preload等待主backend成功', async () => {
    const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-plugin-extra-build-')); tempRoots.push(repositoryRoot);
    const packageDir = createPlugin(repositoryRoot, 'fixture', 'fixture', 'disk');
    const configPath = path.join(packageDir, 'package.json'), configuration = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    configuration.scripts = { preload: 'node preload.mjs' };
    configuration.linnya.development.additionalBuilds = [
      { id: 'raster', type: 'configured', builder: 'vite', config: 'vite.worker.config.mts' },
      { id: 'preload', type: 'script', script: 'preload', dependencies: ['backend'] },
    ];
    fs.writeFileSync(configPath, JSON.stringify(configuration));
    const plugins = discoverWorkspaceDiskBackendPlugins(repositoryRoot);
    const tasks = createElectronDevelopmentBuilds({ repositoryRoot, pnpmCli: 'pnpm.cjs', plugins }).filter(task => task.id.startsWith('plugin-fixture'));
    const backend = Promise.withResolvers(), raster = Promise.withResolvers(), started = [];
    const run = runDevelopmentBuildGraph([
      { id: 'schemas' }, { id: 'provider-catalog' }, ...tasks,
      { id: 'electron', dependencies: tasks.map(task => task.id) },
    ], task => { started.push(task.id); return { ready: task.id === 'plugin-fixture' ? backend.promise : task.id === 'plugin-fixture-raster' ? raster.promise : Promise.resolve() }; });
    await new Promise(resolve => setImmediate(resolve));
    expect(started).toContain('plugin-fixture-raster'); expect(started).not.toContain('plugin-fixture-preload'); expect(started).not.toContain('electron');
    backend.resolve(); await new Promise(resolve => setImmediate(resolve));
    expect(started).toContain('plugin-fixture-preload'); expect(started).not.toContain('electron');
    raster.resolve(); await run;
    expect(started[started.length - 1]).toBe('electron');
  });

  it('拒绝悄悄接受未知 backend 装配模式', () => {
    const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-plugin-composition-'));
    tempRoots.push(repositoryRoot);
    createPlugin(repositoryRoot, 'invalid-plugin', 'invalid-plugin', 'inline');

    expect(() => discoverWorkspaceDiskBackendPlugins(repositoryRoot))
      .toThrow('linnya.development.backendLoading 只允许 disk');
  });
});
