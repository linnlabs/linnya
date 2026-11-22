import { app } from 'electron';
import path from 'node:path';

import {
  assertRequiredBundledPluginSeedSucceeded,
  buildBundledPluginRootCandidates,
  findBundledPluginRootFromCandidates,
  seedBundledPlugins,
  type PluginRuntimeEnvironmentResult,
} from './pluginRuntimeBootstrap';

function shouldUseDiskBackendByDefault(): boolean {
  return app.isPackaged || process.env.NODE_ENV === 'production';
}

/** Electron 只负责解析/准备插件物理目录；Backend 插件 registry 只消费已经冻结的环境事实。 */
export function prepareElectronPluginRuntimeEnvironment(): PluginRuntimeEnvironmentResult {
  const userPluginRoot =
    process.env.LINNYA_PLUGIN_ROOT || path.join(app.getPath('userData'), 'plugins');
  process.env.LINNYA_PLUGIN_ROOT = userPluginRoot;
  // 插件所需原生运行时组件与插件同属用户数据，但独立于插件安装目录（多个插件可共享同一运行时）。
  process.env.LINNYA_RUNTIME_ROOT =
    process.env.LINNYA_RUNTIME_ROOT || path.join(app.getPath('userData'), 'runtimes');

  if (!process.env.LINNYA_PLUGIN_BACKEND_LOADING && shouldUseDiskBackendByDefault()) {
    process.env.LINNYA_PLUGIN_BACKEND_LOADING = 'disk';
  }

  // 打包版的随包身份只能来自安装资源。外部环境目录和 cwd
  // 仍可用于源码调试，但不能成为正式版的数据清理授权来源。
  const bundledPluginRoot = findBundledPluginRootFromCandidates(app.isPackaged
    ? [path.join(process.resourcesPath, 'plugins')]
    : buildBundledPluginRootCandidates({
      explicitRoot: process.env.LINNYA_BUNDLED_PLUGIN_ROOT,
      includeImplicitPackagedRoots: shouldUseDiskBackendByDefault(),
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      workingDirectory: process.cwd(),
    }));
  if (bundledPluginRoot) {
    process.env.LINNYA_RESOLVED_BUNDLED_PLUGIN_ROOT = bundledPluginRoot;
  } else {
    delete process.env.LINNYA_RESOLVED_BUNDLED_PLUGIN_ROOT;
  }

  const shouldSeedBundledPlugins =
    process.env.LINNYA_PLUGIN_SEED_BUNDLED !== '0'
    && Boolean(bundledPluginRoot)
    && (shouldUseDiskBackendByDefault()
      || process.env.LINNYA_PLUGIN_BACKEND_LOADING !== 'inline');
  const seedResults = shouldSeedBundledPlugins
    ? seedBundledPlugins({ bundledPluginRoot, userPluginRoot })
    : [];
  assertRequiredBundledPluginSeedSucceeded({ bundledPluginRoot, seedResults });

  return Object.freeze({
    userPluginRoot,
    bundledPluginRoot,
    seedResults,
    backendLoadingMode: process.env.LINNYA_PLUGIN_BACKEND_LOADING,
  });
}

