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

  if (!process.env.LINNYA_PLUGIN_BACKEND_LOADING && shouldUseDiskBackendByDefault()) {
    process.env.LINNYA_PLUGIN_BACKEND_LOADING = 'disk';
  }

  const bundledPluginRoot = findBundledPluginRootFromCandidates(
    buildBundledPluginRootCandidates({
      explicitRoot: process.env.LINNYA_BUNDLED_PLUGIN_ROOT,
      includeImplicitPackagedRoots: shouldUseDiskBackendByDefault(),
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      workingDirectory: process.cwd(),
    }),
  );
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

