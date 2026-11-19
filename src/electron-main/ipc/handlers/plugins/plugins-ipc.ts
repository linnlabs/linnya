import path from 'node:path';
import fs from 'node:fs';
import type Database from 'better-sqlite3';
import { mapTrustedRendererApplicationSurfaces } from '../../../../app-hosts/linnya/plugin-registry/rendererApplicationSurfaceTrust';
import { getRegisteredBackendPluginDirectory } from '../../../../app-hosts/linnya/plugin-registry/builtin';
import type { BackendRuntimeOwner } from '../../../../app-hosts/linnya/backend-runtime/orchestration/backendRuntimeOwner';
import type { BackendRendererIpcStyleRegistrarPort } from '../../../../app-hosts/linnya/adapters/backend-renderer-requests';
import type { BackendRendererIntegrationPort } from '../../../../app-hosts/linnya/desktop-capabilities';
import { PluginStateService } from '../../../../features/plugins/infrastructure/sqlite/plugin-state.service';
import {
  ensureBuiltinBackendPluginsRegistered,
  listRegisteredBackendPluginMetas,
  resetBackendPluginRegistrationForRuntimeChange,
  registerRegisteredBackendPluginIpcHandlers,
  syncRegisteredBackendPluginRuntimeResources,
} from '../../../../app-hosts/linnya/plugin-registry/builtin';
import { isPluginRuntimeDatabaseReady } from '../../../../app-hosts/linnya/plugin-registry/pluginRuntimeState';
import { pluginDiagnostics } from '../../../../app-hosts/linnya/plugin-registry/diagnostics';
import { toolRegistry } from '../../../../app-hosts/linnya/adapters/tools/toolRegistry';
import { clearRegisteredAgentTaskCache } from '../../../../app-hosts/linnya/agent-registry/agentTaskResolver';
import { Logger } from '../../../../shared/logger';
import {
  readBackendDirectPluginDirsFromEnv,
  readDirectPluginDirsFromEnv,
} from '../../../plugins/loader/pluginLayout';
import {
  discoverOfficialPluginPackageDirsFromWorkspace,
  listRendererPluginEntriesFromLayout,
  shouldPreferSourceRendererPluginEntriesForEnvironment,
} from '../../../plugins/loader/rendererPluginEntries';
import {
  buildPluginStoreList,
  isPluginVisibleInStore,
} from '../../../../features/plugins/store/functions/buildPluginStoreList';
import { buildPluginStoreDetail } from '../../../plugins/store/pluginStoreDetail';
import { uninstallPluginAndDeleteData, uninstallPluginLifecycle } from '../../../../features/plugins/install/orchestration/uninstallPluginLifecycle';
import { installPluginFromRemoteAndActivate } from '../../../../features/plugins/install/orchestration/installPluginFromRemoteAndActivate';
import { installPluginFromBundledAndActivate } from '../../../../features/plugins/install/orchestration/installPluginFromBundledAndActivate';
import { checkPluginUpdateFromRemote } from '../../../../features/plugins/install/orchestration/installPluginUpdate';
import { resolvePluginLatestManifestUrl } from '../../../../features/plugins/install/functions/resolvePluginLatestManifestUrl';
import { isOfficialPluginRemoteServiceEnabled } from '../../../../features/plugins/install/functions/isOfficialPluginRemoteServiceEnabled';
import { runPluginLifecycleOperationSerially } from '../../../../features/plugins/install/orchestration/pluginLifecycleSerialExecutor';
import { resolveDiskPluginUpgradePlan } from '../../../plugins/install/diskPluginUpgradePlan';
import { getRunSupervisor } from '../../../services/agentRuntimeSingletons';
import { cancelActiveRunsForPluginRuntimeChange } from '../../../../app-hosts/linnya/plugin-registry/pluginRuntimeRunInvalidation';
import {
  assertBackendPluginCanDeactivate,
  beginBackendPluginDeactivation,
  deactivateStaleBackendPluginRuntimeEffects,
} from '../../../../app-hosts/linnya/plugin-registry/runtimeEffectRuntime';
import { backendPluginRegistry } from '../../../../app-hosts/linnya/plugin-registry/registry';
import { getRuntimeEnabledPluginIds } from '../../../../app-hosts/linnya/plugin-registry/pluginRuntimeState';
import { isTrustedKnowledgeResourceSource } from '../../../../app-hosts/linnya/plugin-registry/knowledgeResourceAdmission';
import { RENDERER_UI_VERSION } from '@linnya/renderer-ui/version';
import type { DistributionIdentity } from '../../../../shared/distribution-identity';
import { parsePluginManifest, type PluginMeta, type PluginOperationFailure } from '@app/schemas';
import { resolvePluginDataRootForManifest, resolveRegisteredPluginDataRoot } from '../../../../app-hosts/linnya/plugin-registry/pluginDataRoot';
import { readPluginDataSummary } from '../../../../features/plugins/infrastructure/cleanup/pluginDataCleanup';
import { pathManager } from '../../../../shared/utils/pathManager';
import { readJsonFile } from '../../../plugins/loader/pluginLayout';
import {
  listBundledPluginManifestIds,
  listBundledPluginMetas,
  stageBundledPluginForExplicitInstall,
} from '../../../plugins/loader/pluginRuntimeBootstrap';
import { PluginOperationError, toPluginOperationError } from '../../../../features/plugins/install/definitions/pluginOperationError';

const logger = new Logger('PluginsIPC');

function manifestForPlugin(pluginId: string, bundledRoot: string | null): ReturnType<typeof parsePluginManifest> | null {
  const registered = getRegisteredBackendPluginDirectory(pluginId);
  const candidates = [
    ...(registered ? [registered] : []),
    ...(bundledRoot ? [path.join(bundledRoot, pluginId)] : []),
  ];
  for (const directory of candidates) {
    try {
      const manifestPath = path.join(directory, 'plugin.json');
      if (fs.existsSync(manifestPath)) return parsePluginManifest(readJsonFile(manifestPath));
    } catch (error) {
      logger.warn(`[plugins:data] 读取 ${pluginId} manifest 失败`, error);
    }
  }
  return null;
}

function enrichPluginStates(
  states: ReturnType<PluginStateService['listStates']>,
  db: Database.Database,
  bundledRoot: string | null,
): ReturnType<PluginStateService['listStates']> {
  const workspaceRoot = pathManager.getWorkspaceRoot();
  return states.map(state => {
    const manifest = manifestForPlugin(state.meta.id, bundledRoot);
    if (!manifest) return state;
    const hasDeclaredData = manifest.ownedTables.length > 0
      || Object.values(manifest.dataStorage.directories).some(paths => paths.length > 0);
    if (!hasDeclaredData) return state;
    const dataRoot = getRegisteredBackendPluginDirectory(state.meta.id)
      ? resolveRegisteredPluginDataRoot(state.meta.id)
      : resolvePluginDataRootForManifest({ pluginId: state.meta.id, dataStorage: manifest.dataStorage });
    return {
      ...state,
      data: readPluginDataSummary({
        db,
        pluginId: state.meta.id,
        dataRoot,
        dataStorage: manifest.dataStorage,
        pluginInstalled: state.state !== 'missing',
        workspaceRoot,
      }),
    };
  });
}

function throwPluginOperationResultFailure(result: {
  readonly pluginId: string;
  readonly error: string;
  readonly errorCode?: PluginOperationFailure['code'];
}): never {
  throw new PluginOperationError(result.errorCode ?? 'unknown', result.error, {
    pluginId: result.pluginId,
  });
}

function classifyPluginOperationError(error: unknown, pluginId?: string): PluginOperationFailure {
  const operationError = toPluginOperationError(error, { pluginId });
  const effectivePluginId = operationError.pluginId ?? pluginId;
  logger.error('[plugins] operation failed', {
    pluginId: effectivePluginId,
    code: operationError.code,
    message: operationError.message,
    error,
  });
  return {
    code: operationError.code,
    ...(effectivePluginId ? { pluginId: effectivePluginId } : {}),
  };
}

async function syncPluginRuntimeState(options: {
  reinitializeTools: boolean;
  runtimeOwner: BackendRuntimeOwner;
}): Promise<void> {
  // 中文说明：后端模型可见能力现在直接查 DB；写库后仍需重建 ToolRegistry，
  // 让工具描述/参数枚举立刻按最新 enabled 状态收缩；平台运行态资源也必须同步卸载，
  // 避免禁用插件后继续保留 sandbox profile / hidden worker / 全局 adapter。
  await syncRegisteredBackendPluginRuntimeResources();
  registerRegisteredBackendPluginIpcHandlers(options.runtimeOwner);
  if (options.reinitializeTools) {
    toolRegistry.reinitialize();
    clearRegisteredAgentTaskCache();
  }
}

function parsePluginId(value: unknown, label: string): string {
  const pluginId = typeof value === 'string' ? value.trim() : '';
  if (!pluginId) {
    throw new PluginOperationError('unknown', `[${label}] pluginId 不能为空`);
  }
  return pluginId;
}

function resolveKnownPluginLatestManifestUrl(pluginId: string): string {
  return resolvePluginLatestManifestUrl({ pluginId });
}

function shouldPreferSourceRendererPluginEntries(packaged: boolean): boolean {
  const rawMode = process.env.LINNYA_PLUGIN_RENDERER_BUNDLE;
  if (rawMode && rawMode !== 'inline' && rawMode !== 'disk') {
    logger.warn(
      `[plugins:renderer-entries] 未知 renderer 插件加载模式，已按开发态源码入口处理: ${rawMode}`
    );
  }
  return shouldPreferSourceRendererPluginEntriesForEnvironment({
    rendererBundleMode: rawMode,
    nodeEnv: process.env.NODE_ENV,
    linnyaDevMode: process.env.LINNYA_DEV_MODE,
    appIsPackaged: packaged,
  });
}

function resolveBundledPluginRoot(): string | null {
  return (
    process.env.LINNYA_RESOLVED_BUNDLED_PLUGIN_ROOT ??
    process.env.LINNYA_BUNDLED_PLUGIN_ROOT ??
    null
  );
}

function listKnownPluginMetas(): PluginMeta[] {
  const metas = listRegisteredBackendPluginMetas();
  const seen = new Set(metas.map(meta => meta.id));
  const bundledRoot = resolveBundledPluginRoot();
  if (!bundledRoot) return metas;
  for (const meta of listBundledPluginMetas(bundledRoot)) {
    if (!seen.has(meta.id)) {
      seen.add(meta.id);
      metas.push(meta);
    }
  }
  return metas;
}

export async function registerPluginsHandlers(input: {
  readonly runtimeOwner: BackendRuntimeOwner;
  readonly ipc: BackendRendererIpcStyleRegistrarPort;
  readonly applicationVersion: string;
  readonly packaged: boolean;
  readonly distributionIdentity: DistributionIdentity;
  readonly rendererIntegration: Pick<BackendRendererIntegrationPort, 'publishPluginsChanged'>;
}): Promise<void> {
  const databaseService = input.runtimeOwner.getServices().databaseService;
  if (!databaseService) {
    logger.error('DatabaseService 不可用，插件 IPC 未注册');
    throw new Error('[plugins:init] DatabaseService 不可用');
  }

  if (!isPluginRuntimeDatabaseReady()) {
    throw new Error('[plugins:init] 插件运行态数据库尚未由 ServiceInitializer 注入');
  }
  const getService = () => new PluginStateService(databaseService.getDb());
  // 中文说明：内置插件登记由 DatabaseService 的 PluginLifecycleBootstrap 负责；
  // IPC 入口重建工具集合，避免启动早期读取过工具表时继续使用旧 schema。
  await syncPluginRuntimeState({ reinitializeTools: true, runtimeOwner: input.runtimeOwner });

  input.ipc.handle('plugins:list', async () => {
    try {
      return { success: true, data: enrichPluginStates(getService().listStates(listKnownPluginMetas()), databaseService.getDb(), resolveBundledPluginRoot()) };
    } catch (error) {
      logger.error('[plugins:list] failed:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  input.ipc.handle('plugins:store-list', async () => {
    try {
      const states = enrichPluginStates(getService().listStates(listKnownPluginMetas()), databaseService.getDb(), resolveBundledPluginRoot());
      const bundledPluginRoot = resolveBundledPluginRoot();
      const bundledPluginIds = bundledPluginRoot
        ? new Set(listBundledPluginManifestIds(bundledPluginRoot))
        : new Set<string>();
      return {
        success: true,
        data: {
          items: buildPluginStoreList(states, { bundledPluginIds }),
          remoteServiceEnabled: isOfficialPluginRemoteServiceEnabled(input.distributionIdentity),
        },
      };
    } catch (error) {
      logger.error('[plugins:store-list] failed:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  input.ipc.handle('plugins:get-detail', async (_event, rawPluginId: unknown) => {
    try {
      const pluginId = parsePluginId(rawPluginId, 'plugins:get-detail');
      const directPluginDirs = [
        ...new Set([...readBackendDirectPluginDirsFromEnv(), ...readDirectPluginDirsFromEnv()]),
      ];
      const states = enrichPluginStates(getService().listStates(listKnownPluginMetas()), databaseService.getDb(), resolveBundledPluginRoot());
      const state = states.find(item => item.meta.id === pluginId);
      if (!state) {
        throw new Error(`未知插件: ${pluginId}`);
      }
      if (!isPluginVisibleInStore(state)) {
        throw new Error(`插件不在商店中: ${pluginId}`);
      }
      const bundledPluginRoot = resolveBundledPluginRoot();
      return {
        success: true,
        data: buildPluginStoreDetail(state, {
          pluginRoot: process.env.LINNYA_PLUGIN_ROOT,
          directPluginDirs,
          bundledPluginRoot,
          reportDiagnostic: diagnostic => {
            pluginDiagnostics.record({
              level: 'warn',
              pluginId: diagnostic.pluginId,
              capability: null,
              message: diagnostic.message,
            });
          },
        }),
      };
    } catch (error) {
      logger.error('[plugins:get-detail] failed:', error);
      return { success: false, error: classifyPluginOperationError(error) };
    }
  });

  input.ipc.handle('plugins:diagnostics', async () => {
    try {
      return { success: true, data: pluginDiagnostics.list() };
    } catch (error) {
      logger.error('[plugins:diagnostics] failed:', error);
      return { success: false, error: classifyPluginOperationError(error) };
    }
  });

  input.ipc.handle('plugins:renderer-entries', async () => {
    try {
      const knownPluginIds = new Set(listRegisteredBackendPluginMetas().map(meta => meta.id));
      const enabledIds = new Set(
        getService()
          .getEnabledIds()
          .filter(pluginId => knownPluginIds.has(pluginId))
      );
      const directPluginDirs = readDirectPluginDirsFromEnv();
      const officialPluginPackageDirs = [
        ...new Set([
          ...discoverOfficialPluginPackageDirsFromWorkspace(process.cwd(), [...knownPluginIds]),
          ...readBackendDirectPluginDirsFromEnv(),
        ]),
      ];
      const preferSourceEntries = shouldPreferSourceRendererPluginEntries(input.packaged);
      const entries = listRendererPluginEntriesFromLayout({
        pluginRoot: process.env.LINNYA_PLUGIN_ROOT,
        directPluginDirs,
        officialPluginPackageDirs,
        preferSourceEntries,
        enabledIds,
        reportDiagnostic: diagnostic => {
          pluginDiagnostics.record({
            level: 'warn',
            pluginId: diagnostic.pluginId,
            capability: null,
            message: diagnostic.message,
          });
        },
      });
      return {
        success: true,
        data: mapTrustedRendererApplicationSurfaces(entries, {
          packaged: input.packaged,
          workspaceRoot: process.cwd(),
          backendDirectDirs: input.packaged ? [] : readBackendDirectPluginDirsFromEnv(),
          bundledPluginRoot: process.env.LINNYA_RESOLVED_BUNDLED_PLUGIN_ROOT,
          getRegisteredPluginDirectory: getRegisteredBackendPluginDirectory,
            recordDiagnostic: diagnostic => pluginDiagnostics.record({
              level: 'error',
              pluginId: diagnostic.pluginId,
              capability: null,
              message: diagnostic.message,
            }),
        }),
      };
    } catch (error) {
      logger.error('[plugins:renderer-entries] failed:', error);
      return { success: false, error: classifyPluginOperationError(error) };
    }
  });

  input.ipc.handle(
    'plugins:set-enabled',
    async (_event, rawPluginId: unknown, enabled: boolean) => {
      try {
        const pluginId = parsePluginId(rawPluginId, 'plugins:set-enabled');
        return await runPluginLifecycleOperationSerially({
          pluginId,
          operation: 'set-enabled',
          async run() {
            const service = getService();
            if (!enabled) assertBackendPluginCanDeactivate(pluginId);
            service.setEnabled(pluginId, enabled, listRegisteredBackendPluginMetas());
            if (!enabled) beginBackendPluginDeactivation(pluginId);
            if (!isTrustedKnowledgeResourceSource(pluginId))
              await cancelActiveRunsForPluginRuntimeChange({
                pluginId,
                operation: enabled ? '启用' : '禁用',
                supervisor: getRunSupervisor(),
              });
            await syncPluginRuntimeState({
              reinitializeTools: true,
              runtimeOwner: input.runtimeOwner,
            });
            input.rendererIntegration.publishPluginsChanged();
            return { success: true };
          },
        });
      } catch (error) {
        logger.error('[plugins:set-enabled] failed:', error);
        return { success: false, error: classifyPluginOperationError(error, typeof rawPluginId === 'string' ? rawPluginId : undefined) };
      }
    }
  );

  input.ipc.handle('plugins:checkRemoteUpdate', async (_event, rawPluginId: unknown) => {
    try {
      if (!isOfficialPluginRemoteServiceEnabled(input.distributionIdentity)) {
        throw new PluginOperationError('source-unavailable', '当前版本暂不提供插件远程安装和更新，请使用随包插件');
      }
      const pluginId = parsePluginId(rawPluginId, 'plugins:checkRemoteUpdate');
      const service = getService();
      const states = service.listStates(listRegisteredBackendPluginMetas());
      const state = states.find(item => item.meta.id === pluginId);
      if (!state) {
        throw new Error(`未知插件: ${pluginId}`);
      }
      if (!isPluginVisibleInStore(state)) {
        throw new Error(`插件不在商店中: ${pluginId}`);
      }
      const installedRecord = service.getInstalledRecord(pluginId);
      const result = await checkPluginUpdateFromRemote({
        pluginId,
        latestManifestUrl: resolveKnownPluginLatestManifestUrl(pluginId),
        appVersion: input.applicationVersion,
        rendererUiVersion: RENDERER_UI_VERSION,
        currentVersion: installedRecord?.installed ? installedRecord.version : null,
      });
      if (result.status === 'failed') throwPluginOperationResultFailure(result);
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      logger.error('[plugins:checkRemoteUpdate] failed:', error);
      return { success: false, error: classifyPluginOperationError(error, typeof rawPluginId === 'string' ? rawPluginId : undefined) };
    }
  });

  input.ipc.handle('plugins:installFromRemote', async (_event, rawPluginId: unknown) => {
    try {
      if (!isOfficialPluginRemoteServiceEnabled(input.distributionIdentity)) {
        throw new Error('当前版本暂不提供插件远程安装和更新，请使用随包插件');
      }
      const pluginId = parsePluginId(rawPluginId, 'plugins:installFromRemote');
      return await runPluginLifecycleOperationSerially({
        pluginId,
        operation: 'install-from-remote',
        async run() {
          const userPluginRoot = process.env.LINNYA_PLUGIN_ROOT;
          if (!userPluginRoot) {
            throw new PluginOperationError('source-unavailable', '插件目录未初始化，不能远程安装插件', { pluginId });
          }
          const db = databaseService.getDb();
          const knownPlugins = listKnownPluginMetas();
          assertBackendPluginCanDeactivate(pluginId);
          const scopedLifecycle = isTrustedKnowledgeResourceSource(pluginId);
          const result = await installPluginFromRemoteAndActivate({
            db,
            userPluginRoot,
            pluginId,
            latestManifestUrl: resolveKnownPluginLatestManifestUrl(pluginId),
            appVersion: input.applicationVersion,
            rendererUiVersion: RENDERER_UI_VERSION,
            knownPlugins,
            resolveUpgradePlan: resolveDiskPluginUpgradePlan,
            recordDiagnostic: diagnostic => pluginDiagnostics.record(diagnostic),
          });
          if (result.status === 'failed') {
            throwPluginOperationResultFailure(result);
          }
          if (!scopedLifecycle)
            await cancelActiveRunsForPluginRuntimeChange({
              pluginId,
              operation: '安装/升级',
              supervisor: getRunSupervisor(),
            });
          await syncPluginRuntimeState({
            reinitializeTools: true,
            runtimeOwner: input.runtimeOwner,
          });
          input.rendererIntegration.publishPluginsChanged();
          return { success: true, data: result };
        },
      });
    } catch (error) {
      logger.error('[plugins:installFromRemote] failed:', error);
      return { success: false, error: classifyPluginOperationError(error) };
    }
  });

  input.ipc.handle('plugins:installBundled', async (_event, rawPluginId: unknown) => {
    try {
      const pluginId = parsePluginId(rawPluginId, 'plugins:installBundled');
      const bundledPluginRoot = resolveBundledPluginRoot();
      if (!bundledPluginRoot || !listBundledPluginManifestIds(bundledPluginRoot).includes(pluginId)) {
        throw new PluginOperationError('source-unavailable', `当前版本没有可用的随包插件 artifact: ${pluginId}`, { pluginId });
      }
      return await runPluginLifecycleOperationSerially({
        pluginId,
        operation: 'install-from-bundled',
        async run() {
          const userPluginRoot = process.env.LINNYA_PLUGIN_ROOT;
          if (!userPluginRoot) {
            throw new PluginOperationError('source-unavailable', '插件目录未初始化，不能从随包安装插件', { pluginId });
          }
          const result = installPluginFromBundledAndActivate({
            db: databaseService.getDb(),
            userPluginRoot,
            pluginId,
            appVersion: input.applicationVersion,
            knownPlugins: listKnownPluginMetas(),
            stageBundledPlugin: () => stageBundledPluginForExplicitInstall({
              bundledPluginRoot,
              userPluginRoot,
              pluginId,
            }),
            resolveUpgradePlan: resolveDiskPluginUpgradePlan,
            recordDiagnostic: diagnostic => pluginDiagnostics.record(diagnostic),
          });
          if (result.status === 'failed') {
            throwPluginOperationResultFailure(result);
          }
          try {
            resetBackendPluginRegistrationForRuntimeChange();
            ensureBuiltinBackendPluginsRegistered({
              applicationVersion: input.applicationVersion,
              requireComplete: true,
            });
            await syncPluginRuntimeState({
              reinitializeTools: true,
              runtimeOwner: input.runtimeOwner,
            });
            input.rendererIntegration.publishPluginsChanged();
            return { success: true, data: result };
          } catch (runtimeRefreshError) {
            // 安装编排已经提交了 SQLite、migration ledger 和 active 指针。
            // registry 刷新失败不能再伪装成“安装失败”，否则用户会重复点击并破坏已安装状态；
            // 让 Renderer 明确提示重启，下一次启动会从 active artifact 重新注册。
            logger.error('[plugins:installBundled] installed but runtime refresh failed:', runtimeRefreshError);
            return {
              success: true,
              data: { ...result, restartRequired: true },
            };
          }
        },
      });
    } catch (error) {
      logger.error('[plugins:installBundled] failed:', error);
      return { success: false, error: classifyPluginOperationError(error, typeof rawPluginId === 'string' ? rawPluginId : undefined) };
    }
  });

  input.ipc.handle('plugins:uninstall', async (_event, rawPluginId: unknown) => {
    try {
      const isRequest = typeof rawPluginId === 'object' && rawPluginId !== null;
      const requestedPluginId = isRequest ? Reflect.get(rawPluginId, 'pluginId') : rawPluginId;
      const pluginId = parsePluginId(requestedPluginId, 'plugins:uninstall');
      const deleteData = isRequest && Reflect.get(rawPluginId, 'deleteData') === true;
      const bundledPluginRoot = resolveBundledPluginRoot();
      const hasBundledSource = bundledPluginRoot !== null
        && listBundledPluginManifestIds(bundledPluginRoot).includes(pluginId);
      if (!hasBundledSource && !isOfficialPluginRemoteServiceEnabled(input.distributionIdentity)) {
        throw new PluginOperationError('source-unavailable', `当前插件没有可用的随包来源，不能卸载: ${pluginId}`, { pluginId });
      }
      return await runPluginLifecycleOperationSerially({
        pluginId,
        operation: 'uninstall',
        async run() {
          const userPluginRoot = process.env.LINNYA_PLUGIN_ROOT;
          if (!userPluginRoot) {
            throw new PluginOperationError('source-unavailable', '插件目录未初始化，不能卸载插件', { pluginId });
          }
          assertBackendPluginCanDeactivate(pluginId);
          beginBackendPluginDeactivation(pluginId);
          await deactivateStaleBackendPluginRuntimeEffects(
            backendPluginRegistry.getRuntimeEffectRegistrations(getRuntimeEnabledPluginIds())
              .filter(registration => registration.pluginId !== pluginId),
          );
          const scopedLifecycle = isTrustedKnowledgeResourceSource(pluginId);
          const registeredDir = getRegisteredBackendPluginDirectory(pluginId);
          const manifest = registeredDir
            ? parsePluginManifest(readJsonFile(path.join(registeredDir, 'plugin.json')))
            : null;
          const lifecycleOptions = {
            db: databaseService.getDb(),
            userPluginRoot,
            pluginId,
            knownPlugins: listKnownPluginMetas(),
            ...(deleteData && manifest ? {
              dataRoot: resolveRegisteredPluginDataRoot(pluginId),
              dataStorage: manifest.dataStorage,
              ownedTables: manifest.ownedTables,
            } : {}),
          };
          const result = deleteData
            ? await uninstallPluginAndDeleteData(lifecycleOptions)
            : uninstallPluginLifecycle(lifecycleOptions);
          if (result.status !== 'uninstalled') {
            throwPluginOperationResultFailure(result);
          }
          if (!scopedLifecycle)
            await cancelActiveRunsForPluginRuntimeChange({
              pluginId,
              operation: '卸载',
              supervisor: getRunSupervisor(),
            });
          await syncPluginRuntimeState({
            reinitializeTools: true,
            runtimeOwner: input.runtimeOwner,
          });
          input.rendererIntegration.publishPluginsChanged();
          return { success: true };
        },
      });
    } catch (error) {
      logger.error('[plugins:uninstall] failed:', error);
      return { success: false, error: classifyPluginOperationError(error, typeof rawPluginId === 'string' ? rawPluginId : undefined) };
    }
  });
}
