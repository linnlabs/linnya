import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  discoverDevelopmentPluginDirs,
  readBackendDirectPluginDirsFromEnv,
  resolvePluginEntryById,
} from '../pluginLayout';

const tempRoots: string[] = [];

function createPluginVersion(
  pluginRoot: string,
  version: string,
  commandSource: string,
): string {
  const pluginDir = path.join(pluginRoot, 'fake', version);
  const commandPath = path.join(pluginDir, 'dist/cli/fake-cli.cjs');
  fs.mkdirSync(path.dirname(commandPath), { recursive: true });
  fs.writeFileSync(commandPath, commandSource, 'utf8');
  fs.writeFileSync(path.join(pluginDir, 'plugin.json'), `${JSON.stringify({
    id: 'fake',
    version,
    entry: {
      backend: './dist/backend/index.cjs',
      command: './dist/cli/fake-cli.cjs',
    },
  })}\n`, 'utf8');
  return commandPath;
}

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe('plugin layout command entry', () => {
  it('backend direct dirs 使用平台路径分隔符解析', () => {
    expect(readBackendDirectPluginDirsFromEnv([
      '/workspace/private-a',
      '/workspace/private-b',
    ].join(path.delimiter))).toEqual([
      '/workspace/private-a',
      '/workspace/private-b',
    ]);
  });

  it('每次按 active.json 解析当前插件版本的 command entry', () => {
    const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-plugin-command-layout-'));
    tempRoots.push(pluginRoot);
    const previousCommand = createPluginVersion(pluginRoot, '1.0.3', 'module.exports = "previous";');
    const currentCommand = createPluginVersion(pluginRoot, '1.1.0', 'module.exports = "current";');
    const activePath = path.join(pluginRoot, 'fake/active.json');
    fs.writeFileSync(activePath, '{"version":"1.0.3"}\n', 'utf8');

    expect(resolvePluginEntryById({
      pluginRoot,
      pluginId: 'fake',
      entryName: 'command',
    })).toBe(previousCommand);

    fs.writeFileSync(activePath, '{"version":"1.1.0"}\n', 'utf8');
    expect(resolvePluginEntryById({
      pluginRoot,
      pluginId: 'fake',
      entryName: 'command',
    })).toBe(currentCommand);
  });

  it('active artifact 未声明或缺失 command entry 时返回不可用', () => {
    const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-plugin-command-missing-'));
    tempRoots.push(pluginRoot);
    createPluginVersion(pluginRoot, '1.1.0', 'module.exports = {};');
    fs.rmSync(path.join(pluginRoot, 'fake/1.1.0/dist/cli/fake-cli.cjs'));
    fs.writeFileSync(path.join(pluginRoot, 'fake/active.json'), '{"version":"1.1.0"}\n', 'utf8');

    expect(resolvePluginEntryById({
      pluginRoot,
      pluginId: 'fake',
      entryName: 'command',
    })).toBeNull();
  });

  it('开发态只枚举具有 plugin.json 的插件包，不维护插件 ID 清单', () => {
    const pluginsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-development-plugins-'));
    tempRoots.push(pluginsRoot);
    const first = path.join(pluginsRoot, 'first');
    const second = path.join(pluginsRoot, 'second');
    const unrelated = path.join(pluginsRoot, 'unrelated');
    fs.mkdirSync(first);
    fs.mkdirSync(second);
    fs.mkdirSync(unrelated);
    fs.writeFileSync(path.join(first, 'plugin.json'), '{}');
    fs.writeFileSync(path.join(second, 'plugin.json'), '{}');

    expect(discoverDevelopmentPluginDirs(pluginsRoot)).toEqual([first, second]);
  });
});
