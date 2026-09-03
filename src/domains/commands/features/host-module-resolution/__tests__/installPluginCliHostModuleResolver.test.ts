import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installPluginCliHostModuleResolver } from '../infrastructure/installPluginCliHostModuleResolver';

describe('plugin CLI host module resolver', () => {
  let testRoot: string;
  let hostAppRoot: string;
  let cliDirectory: string;
  let outsideDirectory: string;
  let restoreResolver: (() => void) | null;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-command-host-modules-'));
    hostAppRoot = path.join(testRoot, 'host');
    cliDirectory = path.join(testRoot, 'plugins/slides/dist/cli');
    outsideDirectory = path.join(testRoot, 'outside');
    restoreResolver = null;

    fs.mkdirSync(path.join(hostAppRoot, 'node_modules/sharp'), { recursive: true });
    fs.mkdirSync(path.join(hostAppRoot, 'node_modules/yoga-layout'), { recursive: true });
    fs.mkdirSync(path.join(hostAppRoot, 'node_modules/unlisted-runtime'), { recursive: true });
    fs.mkdirSync(cliDirectory, { recursive: true });
    fs.mkdirSync(outsideDirectory, { recursive: true });
    fs.writeFileSync(path.join(hostAppRoot, 'package.json'), '{"private":true}\n', 'utf8');
    fs.writeFileSync(
      path.join(hostAppRoot, 'node_modules/sharp/index.js'),
      'module.exports = { source: "host" };\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(hostAppRoot, 'node_modules/unlisted-runtime/index.js'),
      'module.exports = { source: "unlisted" };\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(hostAppRoot, 'node_modules/yoga-layout/package.json'),
      '{"type":"module","exports":{"./load":"./load.js"}}\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(hostAppRoot, 'node_modules/yoga-layout/load.js'),
      'export async function loadYoga() { return {}; }\n',
      'utf8',
    );
  });

  afterEach(() => {
    restoreResolver?.();
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  function installResolver(): void {
    restoreResolver = installPluginCliHostModuleResolver({
      pluginCliDirectory: cliDirectory,
      hostAppRoot,
    });
  }

  it('只为已登记 CLI 从 host app root 解析白名单运行时', () => {
    const entryPath = path.join(cliDirectory, 'entry.cjs');
    fs.writeFileSync(entryPath, 'module.exports = require("sharp");\n', 'utf8');
    installResolver();

    const requireFromCli = createRequire(entryPath);
    expect(requireFromCli(entryPath)).toEqual({ source: 'host' });
  });

  it('支持已登记 CLI 用 require.resolve 定位白名单 ESM 子路径', () => {
    const entryPath = path.join(cliDirectory, 'entry.cjs');
    fs.writeFileSync(
      entryPath,
      'module.exports = require.resolve("yoga-layout/load");\n',
      'utf8',
    );
    installResolver();

    const requireFromCli = createRequire(entryPath);
    expect(requireFromCli(entryPath)).toBe(
      fs.realpathSync(path.join(hostAppRoot, 'node_modules/yoga-layout/load.js')),
    );
  });

  it('不向 CLI 目录外暴露 host 运行时', () => {
    const entryPath = path.join(outsideDirectory, 'entry.cjs');
    fs.writeFileSync(entryPath, 'module.exports = require("sharp");\n', 'utf8');
    installResolver();

    const requireFromOutside = createRequire(entryPath);
    expect(() => requireFromOutside(entryPath)).toThrow(/Cannot find module 'sharp'/);
  });

  it('不向 CLI 目录外暴露 host 的 ESM 子路径解析', () => {
    const entryPath = path.join(outsideDirectory, 'entry.cjs');
    fs.writeFileSync(
      entryPath,
      'module.exports = require.resolve("yoga-layout/load");\n',
      'utf8',
    );
    installResolver();

    const requireFromOutside = createRequire(entryPath);
    expect(() => requireFromOutside(entryPath)).toThrow(/Cannot find module 'yoga-layout\/load'/);
  });

  it('不解析白名单之外的模块名', () => {
    const entryPath = path.join(cliDirectory, 'entry.cjs');
    fs.writeFileSync(entryPath, 'module.exports = require("unlisted-runtime");\n', 'utf8');
    installResolver();

    const requireFromCli = createRequire(entryPath);
    expect(() => requireFromCli(entryPath)).toThrow(/Cannot find module 'unlisted-runtime'/);
  });
});
