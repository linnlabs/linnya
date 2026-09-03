import fs from 'node:fs';
import Module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearBackendHiddenWorkerRuntimePortForTesting,
  installBackendHiddenWorkerRuntimePort,
} from '../../../../app-hosts/linnya/desktop-capabilities';

import {
  listBackendPluginHostModuleSpecifiersForTest,
  resolveBackendPluginHostModuleForTest,
} from '../backendHostModuleResolver';
import { loadBackendPluginsFromDisk } from '../diskPluginLoader';

const tempRoots: string[] = [];

beforeEach(() => {
  installBackendHiddenWorkerRuntimePort(
    Object.freeze({
      registerHiddenWorker: async () => undefined,
      unregisterHiddenWorker: async () => false,
      hasHiddenWorker: () => false,
      listHiddenWorkerIds: () => [],
      ensureHiddenWorkerReady: async () => undefined,
      touchHiddenWorker: () => undefined,
      invokeHiddenWorker: async () => undefined,
    })
  );
});

function makeTempRoot(): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-plugin-loader-'));
  tempRoots.push(tempRoot);
  return tempRoot;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  clearBackendHiddenWorkerRuntimePortForTesting();
});

describe('disk plugin backend loader', () => {
  it('loads an active backend contribution and resolves host SDK modules', () => {
    const tempRoot = makeTempRoot();
    const versionDir = path.join(tempRoot, 'plugins/demo/1.0.0');

    writeJson(path.join(tempRoot, 'plugins/demo/active.json'), {
      version: '1.0.0',
    });
    writeJson(path.join(versionDir, 'plugin.json'), {
      id: 'demo',
      version: '1.0.0',
      name: 'Demo',
      description: 'Demo plugin',
      details: ['Demo plugin details'],
      developer: 'Linnya',
      entry: {
        backend: './dist/backend/index.cjs',
      },
      compat: {
        minApp: '0.0.36',
      },
    });
    fs.mkdirSync(path.join(versionDir, 'dist/backend'), { recursive: true });
    fs.writeFileSync(
      path.join(versionDir, 'dist/backend/index.cjs'),
      `
        const { BaseTool } = require('@plugin/backend/toolRuntime');
        const { listSandboxProfileIds } = require('@plugin/backend/sandboxRuntime');
        const { listHiddenWorkerIds } = require('@plugin/backend/hiddenWorkerRuntime');
        const { defaultTextMeasureService } = require('@plugin/backend/textMeasurement');
        const { getWorkspaceDatabasePath } = require('@plugin/backend/workspaceDatabasePath');
        const { formatConversationFileLocator } = require('@app/schemas/file-locator');
        if (!Array.isArray(listSandboxProfileIds())) {
          throw new Error('sandboxRuntime host module did not expose listSandboxProfileIds');
        }
        if (!Array.isArray(listHiddenWorkerIds())) {
          throw new Error('hiddenWorkerRuntime host module did not expose listHiddenWorkerIds');
        }
        if (!defaultTextMeasureService || typeof defaultTextMeasureService.measure !== 'function') {
          throw new Error('textMeasurement host module did not expose defaultTextMeasureService');
        }
        if (typeof getWorkspaceDatabasePath !== 'function') {
          throw new Error('workspaceDatabasePath host module did not expose getWorkspaceDatabasePath');
        }
        if (formatConversationFileLocator('demo.txt') !== 'conversation:/demo.txt') {
          throw new Error('file-locator host module did not expose the canonical formatter');
        }
        class DemoTool extends BaseTool {}
        module.exports.backendPlugin = {
          meta: {
            id: 'demo',
            name: 'Demo',
            version: '1.0.0',
            description: 'Demo plugin',
            developer: 'Linnya',
            builtin: false,
          },
          toolClasses: [DemoTool],
        };
      `,
      'utf8'
    );

    const loaded = loadBackendPluginsFromDisk({
      pluginRoot: path.join(tempRoot, 'plugins'),
      appVersion: '0.0.36',
    });

    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.contribution.meta.id).toBe('demo');
    expect(loaded[0]?.contribution.toolClasses).toHaveLength(1);
    expect(resolveBackendPluginHostModuleForTest('@plugin/backend/fontResolution')).toBeTruthy();
    expect(resolveBackendPluginHostModuleForTest('@plugin/backend/workspaceDatabasePath')).toBeTruthy();
    expect(resolveBackendPluginHostModuleForTest('@plugin/backend/blockReferenceRuntime')).toBeTruthy();
    expect(resolveBackendPluginHostModuleForTest('@plugin/backend/hiddenWorkerRuntime')).toBeTruthy();
    expect(resolveBackendPluginHostModuleForTest('@plugin/backend/imageInspection')).toBeTruthy();
    expect(resolveBackendPluginHostModuleForTest('@plugin/backend/imageTranscoding')).toBeTruthy();
    expect(resolveBackendPluginHostModuleForTest('@plugin/backend/toolRuntime')).toBeTruthy();
    expect(resolveBackendPluginHostModuleForTest('@plugin/backend/sandboxRuntime')).toBeTruthy();
    expect(resolveBackendPluginHostModuleForTest('@plugin/backend/textMeasurement')).toBeTruthy();
    expect(resolveBackendPluginHostModuleForTest('@plugin/backend/textUnitRuntime')).toBeTruthy();
    expect(resolveBackendPluginHostModuleForTest('@plugin/backend/referenceRuntime')).toBeUndefined();
    expect(resolveBackendPluginHostModuleForTest('@plugin/backend/assetResolution')).toBeUndefined();
    expect(resolveBackendPluginHostModuleForTest('@plugin/backend/pluginRuntime')).toBeTruthy();
    // 5BB：slidesLegacyBackend 过渡桥已删除，禁止再出现在 host module resolver 里。
    expect(resolveBackendPluginHostModuleForTest('@plugin/backend/slidesLegacyBackend')).toBeUndefined();
  });

  it('restores the CommonJS loader after resolving plugin host modules', () => {
    const originalLoad = Reflect.get(Module, '_load');
    const tempRoot = makeTempRoot();
    const versionDir = path.join(tempRoot, 'plugins/demo/1.0.0');

    writeJson(path.join(tempRoot, 'plugins/demo/active.json'), {
      version: '1.0.0',
    });
    writeJson(path.join(versionDir, 'plugin.json'), {
      id: 'demo',
      version: '1.0.0',
      name: 'Demo',
      description: 'Demo plugin',
      details: ['Demo plugin details'],
      developer: 'Linnya',
      entry: {
        backend: './dist/backend/index.cjs',
      },
    });
    fs.mkdirSync(path.join(versionDir, 'dist/backend'), { recursive: true });
    fs.writeFileSync(
      path.join(versionDir, 'dist/backend/index.cjs'),
      `
        require('@plugin/backend/toolRuntime');
        module.exports.backendPlugin = {
          meta: {
            id: 'demo',
            name: 'Demo',
            version: '1.0.0',
            description: 'Demo plugin',
            developer: 'Linnya',
            builtin: false,
          },
        };
      `,
      'utf8'
    );

    const loaded = loadBackendPluginsFromDisk({
      pluginRoot: path.join(tempRoot, 'plugins'),
      appVersion: '0.0.36',
    });

    expect(loaded).toHaveLength(1);
    expect(Reflect.get(Module, '_load')).toBe(originalLoad);
  });

  it('does not expose plugin host SDK modules to files outside the plugin directory', () => {
    const tempRoot = makeTempRoot();
    const versionDir = path.join(tempRoot, 'plugins/demo/1.0.0');
    const outsiderDir = path.join(tempRoot, 'outsider');

    writeJson(path.join(tempRoot, 'plugins/demo/active.json'), {
      version: '1.0.0',
    });
    writeJson(path.join(versionDir, 'plugin.json'), {
      id: 'demo',
      version: '1.0.0',
      name: 'Demo',
      description: 'Demo plugin',
      details: ['Demo plugin details'],
      developer: 'Linnya',
      entry: {
        backend: './dist/backend/index.cjs',
      },
    });
    fs.mkdirSync(path.join(versionDir, 'dist/backend'), { recursive: true });
    fs.mkdirSync(outsiderDir, { recursive: true });
    fs.writeFileSync(
      path.join(outsiderDir, 'probe.cjs'),
      "module.exports = require('@plugin/backend/toolRuntime');",
      'utf8'
    );
    fs.writeFileSync(
      path.join(versionDir, 'dist/backend/index.cjs'),
      `
        const path = require('node:path');
        try {
          require(path.join(${JSON.stringify(outsiderDir)}, 'probe.cjs'));
        } catch (error) {
          module.exports.backendPlugin = {
            meta: {
              id: 'demo',
              name: 'Demo',
              version: '1.0.0',
              description: 'Demo plugin',
              developer: 'Linnya',
              builtin: false,
            },
          };
          return;
        }
        throw new Error('outsider unexpectedly resolved @plugin/backend/toolRuntime');
      `,
      'utf8'
    );

    const loaded = loadBackendPluginsFromDisk({
      pluginRoot: path.join(tempRoot, 'plugins'),
      appVersion: '0.0.36',
    });

    expect(loaded).toHaveLength(1);
  });

  it('keeps the host module resolver map aligned with backend SDK files', () => {
    const backendContractDir = path.resolve('packages/plugin-host-contract/backend');
    const sdkSpecifiers = new Set(
      fs
        .readdirSync(backendContractDir)
        // pluginCli 只有 contribution 类型合同；testRuntime 只服务源码测试。
        // 两者都不是生产插件 artifact 可 require 的宿主运行时模块。
        .filter(
          fileName =>
            fileName.endsWith('.ts') &&
            fileName !== 'index.ts' &&
            fileName !== 'pluginCli.ts' &&
            fileName !== 'testRuntime.ts'
        )
        .map(fileName => `@plugin/backend/${fileName.replace(/\.ts$/, '')}`)
    );

    const registeredSpecifiers = listBackendPluginHostModuleSpecifiersForTest();
    const missing = [...sdkSpecifiers].filter(specifier => !registeredSpecifiers.includes(specifier)).sort();

    expect(missing).toEqual([]);
    expect(registeredSpecifiers).toContain('@app/schemas');
    expect(registeredSpecifiers).toContain('@app/schemas/file-locator');
    expect(registeredSpecifiers).not.toContain('@plugin/backend/electronStoreCredentialRuntime');
  });

  it('rolls back an active version that fails to load and retries the previous version', () => {
    const tempRoot = makeTempRoot();
    const pluginRoot = path.join(tempRoot, 'plugins');
    const previousVersionDir = path.join(pluginRoot, 'demo/1.0.0');
    const failedVersionDir = path.join(pluginRoot, 'demo/1.1.0');

    writeJson(path.join(pluginRoot, 'demo/active.json'), {
      version: '1.1.0',
      previousVersion: '1.0.0',
    });
    writeJson(path.join(previousVersionDir, 'plugin.json'), {
      id: 'demo',
      version: '1.0.0',
      name: 'Demo',
      description: 'Demo plugin',
      details: ['Demo plugin details'],
      developer: 'Linnya',
      entry: {
        backend: './dist/backend/index.cjs',
      },
    });
    writeJson(path.join(failedVersionDir, 'plugin.json'), {
      id: 'demo',
      version: '1.1.0',
      name: 'Demo',
      description: 'Demo plugin',
      details: ['Demo plugin details'],
      developer: 'Linnya',
      entry: {
        backend: './dist/backend/index.cjs',
      },
    });
    fs.mkdirSync(path.join(previousVersionDir, 'dist/backend'), { recursive: true });
    fs.writeFileSync(
      path.join(previousVersionDir, 'dist/backend/index.cjs'),
      `
        module.exports.backendPlugin = {
          meta: {
            id: 'demo',
            name: 'Demo',
            version: '1.0.0',
            description: 'Demo plugin',
            developer: 'Linnya',
            builtin: false,
          },
        };
      `,
      'utf8'
    );
    fs.mkdirSync(path.join(failedVersionDir, 'dist/backend'), { recursive: true });
    fs.writeFileSync(
      path.join(failedVersionDir, 'dist/backend/index.cjs'),
      'throw new Error("broken backend");',
      'utf8'
    );

    const loaded = loadBackendPluginsFromDisk({
      pluginRoot,
      appVersion: '0.0.36',
    });

    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.contribution.meta.version).toBe('1.0.0');
    expect(JSON.parse(fs.readFileSync(path.join(pluginRoot, 'demo/active.json'), 'utf8'))).toEqual({
      version: '1.0.0',
    });
  });

  it('不再兼容具体插件旧导出名，磁盘插件必须导出 backendPlugin 或 default', () => {
    const tempRoot = makeTempRoot();
    const versionDir = path.join(tempRoot, 'plugins/demo/1.0.0');

    writeJson(path.join(tempRoot, 'plugins/demo/active.json'), {
      version: '1.0.0',
    });
    writeJson(path.join(versionDir, 'plugin.json'), {
      id: 'demo',
      version: '1.0.0',
      name: 'Demo',
      description: 'Demo plugin',
      details: ['Demo plugin details'],
      developer: 'Linnya',
      entry: {
        backend: './dist/backend/index.cjs',
      },
    });
    fs.mkdirSync(path.join(versionDir, 'dist/backend'), { recursive: true });
    fs.writeFileSync(
      path.join(versionDir, 'dist/backend/index.cjs'),
      `
        module.exports.mindmapBackendPlugin = {
          meta: {
            id: 'demo',
            name: 'Demo',
            version: '1.0.0',
            description: 'Demo plugin',
            developer: 'Linnya',
            builtin: false,
          },
        };
      `,
      'utf8'
    );

    const loaded = loadBackendPluginsFromDisk({
      pluginRoot: path.join(tempRoot, 'plugins'),
      appVersion: '0.0.36',
    });

    expect(loaded).toEqual([]);
  });
});
