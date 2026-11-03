import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pluginIpcRuntimeMock = vi.hoisted(() => ({
  clearBackendPluginIpcHandlersForPlugin: vi.fn(),
  registerBackendPluginIpcHandler: vi.fn(),
}));

vi.mock('@plugin/backend/pluginIpcRuntime', () => ({
  clearBackendPluginIpcHandlersForPlugin: pluginIpcRuntimeMock.clearBackendPluginIpcHandlersForPlugin,
  registerBackendPluginIpcHandler: pluginIpcRuntimeMock.registerBackendPluginIpcHandler,
}));

// 组合行为测试不测 Vite 冷编译耗时；依赖在收集阶段加载，每例通过正式 reset 隔离注册状态。
import * as builtin from '../builtin';
import * as runtime from '../pluginRuntimeState';

const PLUGIN_ID = 'document-plugin-fixture';
const SECOND_PLUGIN_ID = 'other-plugin-fixture';
const tempRoots: string[] = [];

function makeTempRoot(): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-plugin-composition-'));
  tempRoots.push(tempRoot);
  return tempRoot;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writePluginArtifact(params: {
  readonly pluginDir: string;
  readonly pluginId?: string;
  readonly ipcMode?: 'valid' | 'undeclared' | 'foreign-owner';
  readonly withPluginCli?: boolean;
}): void {
  const pluginId = params.pluginId ?? PLUGIN_ID;
  writeJson(path.join(params.pluginDir, 'plugin.json'), {
    id: pluginId,
    version: '1.0.0',
    name: 'Document Plugin Fixture',
    description: 'Generic disk plugin test contribution',
    developer: 'Linnya',
    details: ['Generic plugin composition test detail'],
    entry: { backend: './dist/backend/index.cjs' },
  });
  fs.mkdirSync(path.join(params.pluginDir, 'dist/backend'), { recursive: true });

  const declaredChannel = `${pluginId}:declared`;
  const actualPluginId = params.ipcMode === 'foreign-owner' ? SECOND_PLUGIN_ID : pluginId;
  const actualChannel = params.ipcMode === 'undeclared' ? `${pluginId}:actual` : declaredChannel;
  fs.writeFileSync(
    path.join(params.pluginDir, 'dist/backend/index.cjs'),
    `
      module.exports.backendPlugin = {
        meta: {
          id: ${JSON.stringify(pluginId)},
          name: 'Document Plugin Fixture',
          version: '1.0.0',
          description: 'Generic disk plugin test contribution',
          developer: 'Linnya',
          builtin: true,
          dependsOn: ['platform'],
        },
        ipc: {
          channels: [${JSON.stringify(declaredChannel)}],
          register(_serviceManager, registrar) {
            registrar(
              ${JSON.stringify(actualPluginId)},
              ${JSON.stringify(actualChannel)},
              () => ({ success: true }),
            );
          },
        },
        ${params.withPluginCli ? `pluginCli: {
          prepare() {
            return { status: 'completed', result: { exitCode: 0, stdout: '', stderr: '' } };
          },
        },` : ''}
      };
    `,
    'utf8',
  );
}

function writeActivePlugin(pluginRoot: string, options: {
  readonly pluginId?: string;
  readonly ipcMode?: 'valid' | 'undeclared' | 'foreign-owner';
  readonly withPluginCli?: boolean;
} = {}): string {
  const pluginId = options.pluginId ?? PLUGIN_ID;
  const pluginDir = path.join(pluginRoot, pluginId, '1.0.0');
  writeJson(path.join(pluginRoot, pluginId, 'active.json'), { version: '1.0.0' });
  writePluginArtifact({ pluginDir, ...options, pluginId });
  return pluginDir;
}

function enablePluginRuntime(): void {
  runtime.setPluginRuntimeStateForTests({
    installedPluginIds: ['platform', PLUGIN_ID],
    enabledPluginIds: ['platform', PLUGIN_ID],
  });
}

const pluginEnvironmentKeys = [
  'LINNYA_PLUGIN_ROOT', 'LINNYA_PLUGIN_DIRECT_DIRS', 'LINNYA_PLUGIN_BACKEND_DIRECT_DIRS',
  'LINNYA_RESOLVED_BUNDLED_PLUGIN_ROOT', 'LINNYA_BUNDLED_PLUGIN_ROOT',
] as const;
beforeEach(() => {
  builtin.resetBackendPluginRegistrationForRuntimeChange();
  runtime.clearPluginRuntimeStateForTests();
  for (const key of pluginEnvironmentKeys) vi.stubEnv(key, undefined);
});

afterEach(() => {
  pluginIpcRuntimeMock.clearBackendPluginIpcHandlersForPlugin.mockClear();
  pluginIpcRuntimeMock.registerBackendPluginIpcHandler.mockClear();
  runtime.clearPluginRuntimeStateForTests();
  builtin.resetBackendPluginRegistrationForRuntimeChange();
  vi.unstubAllEnvs();
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe('generic backend plugin composition', () => {
  it('treats a platform-only Core as a complete runtime when no plugin source is configured', () => {

    expect(builtin.listRegisteredBackendPluginMetas().map((meta) => meta.id)).toEqual(['platform']);
    expect(builtin.getBuiltinBackendPluginRegistrationPhase()).toBe('complete');
  });

  it('defers external code loading until an application version is available, then retries', () => {
    const pluginRoot = makeTempRoot();
    writeActivePlugin(pluginRoot);
    process.env.LINNYA_PLUGIN_ROOT = pluginRoot;

    expect(builtin.listRegisteredBackendPluginMetas().map((meta) => meta.id)).toEqual(['platform']);
    expect(builtin.getBuiltinBackendPluginRegistrationPhase()).toBe('platform-only');
    expect(() => builtin.getRegisteredBackendPluginIpcChannels(
      PLUGIN_ID,
      new Set(['platform', PLUGIN_ID]),
    )).toThrow('后端插件注册尚未完成');

    builtin.ensureBuiltinBackendPluginsRegistered({ applicationVersion: '0.0.38' });
    expect(builtin.getRegisteredBackendPluginIpcChannels(
      PLUGIN_ID,
      new Set(['platform', PLUGIN_ID]),
    )).toEqual([`${PLUGIN_ID}:declared`]);
    expect(builtin.getBuiltinBackendPluginRegistrationPhase()).toBe('complete');
  });

  it('loads a plugin from the backend-only direct directory without a Host identity branch', () => {
    const pluginDir = makeTempRoot();
    writePluginArtifact({ pluginDir });
    process.env.LINNYA_PLUGIN_BACKEND_DIRECT_DIRS = pluginDir;

    builtin.ensureBuiltinBackendPluginsRegistered({ applicationVersion: '0.0.38' });

    expect(builtin.getRegisteredBackendPluginIpcChannels(
      PLUGIN_ID,
      new Set(['platform', PLUGIN_ID]),
    )).toEqual([`${PLUGIN_ID}:declared`]);
  });

  it('trusts Plugin CLI by explicit backend composition source instead of plugin id', () => {
    const pluginDir = makeTempRoot();
    writePluginArtifact({ pluginDir, withPluginCli: true });
    process.env.LINNYA_PLUGIN_BACKEND_DIRECT_DIRS = pluginDir;
    enablePluginRuntime();

    builtin.ensureBuiltinBackendPluginsRegistered({ applicationVersion: '0.0.38' });

    expect(builtin.listRegisteredBackendPluginClis().map((registration) => registration.pluginId))
      .toEqual([PLUGIN_ID]);
  });

  it('rejects Plugin CLI from an untrusted generic direct directory', () => {
    const pluginDir = makeTempRoot();
    writePluginArtifact({ pluginDir, withPluginCli: true });
    process.env.LINNYA_PLUGIN_DIRECT_DIRS = pluginDir;

    expect(() => builtin.ensureBuiltinBackendPluginsRegistered({ applicationVersion: '0.0.38' }))
      .toThrow('只允许来自 Host 可信装配源');
  });

  it('trusts an active Plugin CLI when its identity comes from the resolved bundled artifact root', () => {
    const pluginRoot = makeTempRoot();
    writeActivePlugin(pluginRoot, { withPluginCli: true });
    const bundledRoot = makeTempRoot();
    writePluginArtifact({ pluginDir: path.join(bundledRoot, 'release-plugin'), withPluginCli: true });
    process.env.LINNYA_PLUGIN_ROOT = pluginRoot;
    process.env.LINNYA_RESOLVED_BUNDLED_PLUGIN_ROOT = bundledRoot;
    enablePluginRuntime();

    builtin.ensureBuiltinBackendPluginsRegistered({ applicationVersion: '0.0.38' });

    expect(builtin.listRegisteredBackendPluginClis().map((registration) => registration.pluginId))
      .toEqual([PLUGIN_ID]);
  });

  it('registers atomic IPC contributions through the platform registrar', () => {
    const pluginDir = makeTempRoot();
    writePluginArtifact({ pluginDir });
    process.env.LINNYA_PLUGIN_BACKEND_DIRECT_DIRS = pluginDir;
    enablePluginRuntime();
    builtin.ensureBuiltinBackendPluginsRegistered({ applicationVersion: '0.0.38' });

    builtin.registerRegisteredBackendPluginIpcHandlers({});

    expect(pluginIpcRuntimeMock.registerBackendPluginIpcHandler)
      .toHaveBeenCalledWith(PLUGIN_ID, `${PLUGIN_ID}:declared`, expect.any(Function));
  });

  it('fails fast when an atomic IPC contribution registers an undeclared channel', () => {
    const pluginDir = makeTempRoot();
    writePluginArtifact({ pluginDir, ipcMode: 'undeclared' });
    process.env.LINNYA_PLUGIN_BACKEND_DIRECT_DIRS = pluginDir;
    enablePluginRuntime();
    builtin.ensureBuiltinBackendPluginsRegistered({ applicationVersion: '0.0.38' });

    expect(() => builtin.registerRegisteredBackendPluginIpcHandlers({}))
      .toThrow(`IPC contribution 声明与注册不一致: ${PLUGIN_ID}`);
  });

  it('fails fast when an atomic IPC contribution registers a handler for another plugin id', () => {
    const pluginDir = makeTempRoot();
    writePluginArtifact({ pluginDir, ipcMode: 'foreign-owner' });
    process.env.LINNYA_PLUGIN_BACKEND_DIRECT_DIRS = pluginDir;
    enablePluginRuntime();
    builtin.ensureBuiltinBackendPluginsRegistered({ applicationVersion: '0.0.38' });

    expect(() => builtin.registerRegisteredBackendPluginIpcHandlers({}))
      .toThrow('IPC contribution pluginId 不一致');
  });
});
