import path from 'node:path';
import fs from 'node:fs';
import { isRecord } from '@linnya/foundation';
import type Database from 'better-sqlite3';
import { mapTrustedRendererApplicationSurfaces } from '../../../../app-hosts/linnya/plugin-registry/rendererApplicationSurfaceTrust';
import { getRegisteredBackendPluginDirectory } from '../../../../app-hosts/linnya/plugin-registry/builtin';
import type { BackendRuntimeOwner } from '../../../../app-hosts/linnya/backend-runtime/orchestration/backendRuntimeOwner';
import type { BackendRendererIpcStyleRegistrarPort } from '../../../../app-hosts/linnya/adapters/backend-renderer-requests';
import type { BackendRendererIntegrationPort, DesktopFileRevealPort } from '../../../../app-hosts/linnya/desktop-capabilities';
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
import type { RemotePluginReleaseSource, RemotePluginRuntimeInstaller } from '../../../../features/plugins/install/definitions/pluginInstall';
import { installRuntimeComponent, isRuntimeComponentCurrent } from '../../../../features/runtimes/orchestration/installRuntimeComponent';
import { createCatalogPluginReleaseSource } from '../../../../features/plugins/catalog/orchestration/createCatalogPluginReleaseSource';
import { createPluginCatalogStateStore } from '../../../../features/plugins/catalog/infrastructure/pluginCatalogStateStore';
import {
  resolvePluginCatalogSource,
  resolveTrustedPluginCatalogKeys,
  type PluginCatalogSource,
} from '../../../../features/plugins/catalog/functions/resolvePluginCatalogSource';
import { buildPluginRemoteCatalogView, runtimeKey } from '../../../../features/plugins/catalog/functions/buildPluginRemoteCatalogView';
import { resolveCatalogPlatform } from '../../../../features/plugins/catalog/functions/resolveCatalogPlatform';
import { fetchVerifiedPluginCatalog } from '../../../../features/plugins/catalog/orchestration/fetchVerifiedPluginCatalog';
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
import {
  parsePluginManifest,
  type PluginDataSummary,
  type PluginMeta,
  type PluginOperationFailure,
  type PluginRemoteCatalogResult,
} from '@app/schemas';
import { resolvePluginCleanupDescriptor } from '../../../../app-hosts/linnya/plugin-registry/pluginDataRoot';
import { readPluginDataSummaryAsync, cleanupPluginData, hasPendingPluginDataCleanup, hasPluginUserData } from '../../../../features/plugins/infrastructure/cleanup/pluginDataCleanup';
import {
  listOnDemandPluginDeclarations,
  listPluginDeclarationMetas,
} from '../../../../features/plugins/install/infrastructure/readPluginDeclarations';
import { restoreDeclaredPluginsWithUserData } from '../../../../features/plugins/install/orchestration/restoreDeclaredPluginsWithUserData';
import { readJsonFile } from '../../../plugins/loader/pluginLayout';
import {
  listBundledPluginManifestIds,
  listBundledPluginMetas,
  stageBundledPluginForExplicitInstall,
} from '../../../plugins/loader/pluginRuntimeBootstrap';
import { PluginOperationError, toPluginOperationError } from '../../../../features/plugins/install/definitions/pluginOperationError';

const logger = new Logger('PluginsIPC');
const PLUGIN_DATA_SUMMARY_CACHE_TTL_MS = 2000;
const pluginDataSummaryCache = new Map<string, {
  readonly expiresAt: number;
  readonly data: PluginDataSummary;
}>();
const pluginDataSummaryPending = new Map<string, AbortController>();
const pausedPluginDataMeasurements = new Set<string>();
const emptyPluginData = { bytes: 0, directories: { source: 0, derived: 0, runtime: 0 }, tables: {} };

function abortPluginDataMeasurement(pluginId: string): void {
  pluginDataSummaryPending.get(pluginId)?.abort();
  pluginDataSummaryPending.delete(pluginId);
}

function invalidatePluginDataSummary(pluginId: string): void {
  abortPluginDataMeasurement(pluginId);
  pausedPluginDataMeasurements.delete(pluginId);
  pluginDataSummaryCache.delete(pluginId);
}

function declaresCleanableData(manifest: ReturnType<typeof parsePluginManifest>): boolean {
  return Object.values(manifest.dataStorage.directories).some(paths => paths.length > 0);
}

function manifestForPlugin(pluginId: string, bundledRoot: string | null): ReturnType<typeof parsePluginManifest> | null {
  const registered = getRegisteredBackendPluginDirectory(pluginId);
  const declarationRoot = process.env.LINNYA_RESOLVED_PLUGIN_DECLARATION_ROOT;
  // 远程分发插件未安装时没有已登记目录与随包副本，数据声明来自安装包内的 plugin.json。
  const candidates = [
    ...(registered ? [registered] : []),
    ...(bundledRoot ? [path.join(bundledRoot, pluginId)] : []),
    ...(declarationRoot ? [path.join(declarationRoot, pluginId)] : []),
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
  bundledRoot: string | null,
  scheduleSummary: (state: ReturnType<PluginStateService['listStates']>[number]) => void,
): ReturnType<PluginStateService['listStates']> {
  const enriched: ReturnType<PluginStateService['listStates']> = [];
  for (const state of states) {
    const manifest = manifestForPlugin(state.meta.id, bundledRoot);
    if (!manifest) {
      enriched.push(state);
      continue;
    }
    if (!declaresCleanableData(manifest)) {
      enriched.push(state);
      continue;
    }
    const cached = pluginDataSummaryCache.get(state.meta.id);
    if (pausedPluginDataMeasurements.has(state.meta.id)) {
      enriched.push({ ...state, data: cached?.data, dataMeasurement: 'paused' });
      continue;
    }
    if (cached && cached.expiresAt > Date.now()) {
      enriched.push({ ...state, data: cached.data });
      continue;
    }
    scheduleSummary(state);
    enriched.push({ ...state, data: cached?.data, dataMeasurement: 'running' });
  }
  return enriched;
}

function schedulePluginDataSummary(
  state: ReturnType<PluginStateService['listStates']>[number],
  db: Database.Database,
  onUpdated: (pluginId: string) => void,
): void {
  if (pluginDataSummaryPending.has(state.meta.id)) return;
  const controller = new AbortController();
  pluginDataSummaryPending.set(state.meta.id, controller);
  void (async () => {
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      if (controller.signal.aborted) return;
      const descriptor = resolvePluginCleanupDescriptor(state.meta.id);
      if (!descriptor) {
        pluginDataSummaryCache.set(state.meta.id, {
          expiresAt: Date.now() + PLUGIN_DATA_SUMMARY_CACHE_TTL_MS,
          data: { ...emptyPluginData, status: 'unavailable', canDelete: false },
        });
        return;
      }
      const data = await readPluginDataSummaryAsync({
        db,
        pluginId: state.meta.id,
        dataRoot: descriptor.dataRoot,
        dataStorage: descriptor.manifest.dataStorage,
        ownedTables: descriptor.manifest.ownedTables,
        pluginInstalled: state.state !== 'missing',
        userRemoved: new PluginStateService(db).getInstalledRecord(state.meta.id)?.userRemoved === true,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      pluginDataSummaryCache.set(state.meta.id, { expiresAt: Date.now() + PLUGIN_DATA_SUMMARY_CACHE_TTL_MS, data });
    } catch (error) {
      if (controller.signal.aborted) return;
      pluginDataSummaryCache.set(state.meta.id, {
        expiresAt: Date.now() + PLUGIN_DATA_SUMMARY_CACHE_TTL_MS,
        data: {
          status: 'unavailable',
          ...emptyPluginData,
          errorCode: 'unknown',
          canDelete: false,
        },
      });
      pluginDiagnostics.record({
        level: 'warn',
        pluginId: state.meta.id,
        capability: null,
        message: `读取插件数据占用失败，已降级显示插件状态: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      if (!controller.signal.aborted) {
        pluginDataSummaryPending.delete(state.meta.id);
        onUpdated(state.meta.id);
      }
    }
  })();
}

function throwPluginOperationResultFailure(result: {
  readonly pluginId: string;
  readonly error: string;
  readonly errorCode?: PluginOperationFailure['code'];
  readonly diskSpace?: PluginOperationFailure['diskSpace'];
}): never {
  throw new PluginOperationError(result.errorCode ?? 'unknown', result.error, {
    pluginId: result.pluginId,
    ...(result.diskSpace ? { diskSpace: result.diskSpace } : {}),
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
    ...(operationError.diskSpace ? { diskSpace: operationError.diskSpace } : {}),
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

/** 插件所需原生运行时按同一份已验签 catalog 安装到 LINNYA_RUNTIME_ROOT。 */
function createOfficialRuntimeInstaller(
  pluginId: string,
  userPluginRoot: string,
  source: PluginCatalogSource,
): RemotePluginRuntimeInstaller {
  const resolveRuntimeRoot = (): string => {
    const runtimeRoot = process.env.LINNYA_RUNTIME_ROOT;
    if (!runtimeRoot) {
      throw new PluginOperationError('source-unavailable', '运行时目录未初始化，不能安装插件所需的运行时', { pluginId });
    }
    return runtimeRoot;
  };
  const readRevocations = () => createPluginCatalogStateStore({ userPluginRoot }).readRevocations();
  return {
    async pending(runtimes) {
      const runtimeRoot = resolveRuntimeRoot();
      const laterRevocations = readRevocations();
      const pending = [];
      for (const runtime of runtimes) {
        const current = await isRuntimeComponentCurrent({ runtimeRoot, runtime, trustedKeys: source.trustedKeys, laterRevocations });
        if (!current) pending.push(runtime);
      }
      return pending;
    },
    async install(runtime, provenance, control) {
      await installRuntimeComponent({
        runtimeRoot: resolveRuntimeRoot(),
        runtime,
        provenance,
        trustedKeys: source.trustedKeys,
        laterRevocations: readRevocations(),
        fetch: globalThis.fetch,
        control,
      });
    },
  };
}

/** 商店展示用：拉取并验签官方 catalog，按本机平台与已装运行时投影为条目。失败只影响远程条目，不影响已装插件。 */
async function readRemoteCatalog(applicationVersion: string, source: PluginCatalogSource): Promise<PluginRemoteCatalogResult> {
  const userPluginRoot = process.env.LINNYA_PLUGIN_ROOT;
  const runtimeRoot = process.env.LINNYA_RUNTIME_ROOT;
  try {
    if (!userPluginRoot || !runtimeRoot) {
      throw new PluginOperationError('source-unavailable', '插件或运行时目录未初始化，不能读取远程插件 catalog');
    }
    const target = resolveCatalogPlatform(process.platform, process.arch);
    if (!target) throw new PluginOperationError('incompatible', `当前平台不提供远程插件: ${process.platform}/${process.arch}`);
    const stateStore = createPluginCatalogStateStore({
      userPluginRoot,
      recordDiagnostic: message => pluginDiagnostics.record({ level: 'warn', pluginId: null, capability: null, message }),
    });
    const catalog = await fetchVerifiedPluginCatalog({
      catalogUrl: source.catalogUrl,
      channel: source.channel,
      trustedKeys: source.trustedKeys,
      stateStore,
      allowLoopbackHttp: source.allowLoopbackHttp,
    });
    const laterRevocations = stateStore.readRevocations();
    const installedRuntimes = new Set<string>();
    for (const runtime of catalog.runtimes) {
      const runtimeTarget = runtime.targets.find(item => item.platform === target.platform && item.architecture === target.architecture);
      if (!runtimeTarget) continue;
      const current = await isRuntimeComponentCurrent({
        runtimeRoot,
        runtime: { id: runtime.id, version: runtime.version, target: runtimeTarget },
        trustedKeys: source.trustedKeys,
        laterRevocations,
      });
      if (current) installedRuntimes.add(runtimeKey(runtime.id, runtime.version));
    }
    return {
      status: 'available',
      items: buildPluginRemoteCatalogView({
        catalog,
        appVersion: applicationVersion,
        rendererUiVersion: RENDERER_UI_VERSION,
        ...target,
        installedRuntimes,
      }),
    };
  } catch (error) {
    const operationError = toPluginOperationError(error);
    logger.warn('[plugins:remote-catalog] unavailable', { code: operationError.code, message: operationError.message });
    return { status: 'unavailable', code: operationError.code };
  }
}

/** 远程版本来源：只认受信 key 签名的 catalog（官方或源码运行的开发 catalog），并在用户插件根记录高水位。 */
function createCatalogReleaseSource(pluginId: string, source: PluginCatalogSource): RemotePluginReleaseSource {
  const userPluginRoot = process.env.LINNYA_PLUGIN_ROOT;
  if (!userPluginRoot) {
    throw new PluginOperationError('source-unavailable', '插件目录未初始化，不能读取远程插件 catalog', { pluginId });
  }
  return createCatalogPluginReleaseSource({
    catalogUrl: source.catalogUrl,
    channel: source.channel,
    trustedKeys: source.trustedKeys,
    allowLoopbackHttp: source.allowLoopbackHttp,
    stateStore: createPluginCatalogStateStore({
      userPluginRoot,
      recordDiagnostic: message => pluginDiagnostics.record({ level: 'warn', pluginId, capability: null, message }),
    }),
    platform: process.platform,
    architecture: process.arch,
  });
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
  // 随包插件与安装包内声明的远程分发插件都是“已知插件”：未安装时也能展示、统计资料与清理。
  const candidates = [
    ...(bundledRoot ? listBundledPluginMetas(bundledRoot) : []),
    ...listPluginDeclarationMetas(process.env.LINNYA_RESOLVED_PLUGIN_DECLARATION_ROOT),
  ];
  for (const meta of candidates) {
    if (!seen.has(meta.id)) {
      seen.add(meta.id);
      metas.push(meta);
    }
  }
  return metas;
}

function listDisplayPluginStates(service: PluginStateService): ReturnType<PluginStateService['listStates']> {
  return service.listStates(listKnownPluginMetas()).map(state => {
    if (state.state === 'missing') return state;
    const installed = service.getInstalledRecord(state.meta.id);
    if (backendPluginRegistry.has(state.meta.id)) {
      // 远程更新已激活但后端仍是旧版本：商店按已安装版本判断是否还有更新，避免重启前一直显示“更新”。
      return installed?.installed && installed.version !== state.meta.version
        ? { ...state, pendingRestartVersion: installed.version }
        : state;
    }
    return {
      ...state,
      meta: { ...state.meta, version: installed?.version ?? state.meta.version },
      runtimeUnavailable: true,
    };
  });
}

export async function registerPluginsHandlers(input: {
  readonly runtimeOwner: BackendRuntimeOwner;
  readonly ipc: BackendRendererIpcStyleRegistrarPort;
  readonly applicationVersion: string;
  readonly packaged: boolean;
  readonly distributionIdentity: DistributionIdentity;
  readonly fileReveal: DesktopFileRevealPort;
  readonly rendererIntegration: Pick<
    BackendRendererIntegrationPort,
    'publishPluginsChanged' | 'publishPluginDataChanged' | 'publishPluginInstallProgress'
  >;
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
  const getDb = () => databaseService.getDb();
  let runtimeTransitionTail = Promise.resolve();
  function transitionRuntime<T>(operation: () => Promise<T>): Promise<T> {
    // 按插件排队不保护共享注册表。状态提交和运行态同步必须使用同一条队列，
    // 否则同步拿到的启用列表会在 await 之后把另一个刚卸载的插件重新启动。
    const result = runtimeTransitionTail.then(operation);
    runtimeTransitionTail = result.then(() => {}, () => {});
    return result;
  }
  const cleanupAbortControllers = new Map<string, AbortController>();
  /** 正在下载的远程安装；只覆盖 run() 内的下载阶段，排队中的安装没有控制器，取消请求返回 cancelled=false。 */
  const remoteInstallAbortControllers = new Map<string, AbortController>();
  /** 远程来源在注册时确定：官方 Desktop 用官方 catalog；源码运行可用开发 catalog；都不满足时为 null，不发请求。 */
  const remoteSource = resolvePluginCatalogSource({ identity: input.distributionIdentity, env: process.env });
  const trustedCatalogKeys = resolveTrustedPluginCatalogKeys({ identity: input.distributionIdentity, env: process.env });
  const publishPluginDataChanged = (pluginId: string): void => {
    input.rendererIntegration.publishPluginDataChanged(pluginId);
  };

  input.ipc.handle('plugins:set-data-measurement-paused', async (_event, raw: unknown) => {
    try {
      if (!isRecord(raw) || typeof raw.paused !== 'boolean') throw new Error('插件数据统计未指定暂停状态');
      const pluginId = parsePluginId(raw.pluginId, 'plugins:set-data-measurement-paused');
      const { paused } = raw;
      // 用户点击与扫描完成可能交错；完成的扫描不需要被取消或丢弃。
      if (paused && pluginDataSummaryPending.has(pluginId)) {
        pausedPluginDataMeasurements.add(pluginId);
        abortPluginDataMeasurement(pluginId);
      } else if (!paused) {
        pausedPluginDataMeasurements.delete(pluginId);
      }
      publishPluginDataChanged(pluginId);
      return { success: true };
    } catch (error) {
      logger.error('[plugins:set-data-measurement-paused] failed:', error);
      return { success: false, error: classifyPluginOperationError(error) };
    }
  });
  function beginCleanup(pluginId: string): void {
    const prior = pluginDataSummaryCache.get(pluginId)?.data;
    invalidatePluginDataSummary(pluginId);
    pluginDataSummaryCache.set(pluginId, {
      expiresAt: Infinity,
      data: { ...emptyPluginData, bytes: prior?.bytes ?? 0, directories: prior?.directories ?? emptyPluginData.directories,
        tables: prior?.tables ?? {}, status: 'cleaning', removedEntries: 0, canDelete: false },
    });
    publishPluginDataChanged(pluginId);
  }

  function createCleanupProgressReporter(pluginId: string): (removedEntries: number) => void {
    let nextUpdate = 0;
    return removedEntries => {
      const now = Date.now();
      if (now < nextUpdate) return;
      const current = pluginDataSummaryCache.get(pluginId);
      if (current?.data.status !== 'cleaning') return;
      // 只刷新本机数据面板，不因目录中每个条目都跨进程同步。
      nextUpdate = now + 250;
      pluginDataSummaryCache.set(pluginId, { ...current, data: { ...current.data, removedEntries } });
      publishPluginDataChanged(pluginId);
    };
  }

  function endCleanup(pluginId: string): void {
    cleanupAbortControllers.delete(pluginId);
    invalidatePluginDataSummary(pluginId);
    publishPluginDataChanged(pluginId);
  }

  function assertPluginCanInstall(pluginId: string): void {
    if (hasPendingPluginDataCleanup(getDb(), pluginId)) {
      throw new PluginOperationError('unknown', '请先完成插件数据清理，再安装插件', { pluginId });
    }
  }

  input.ipc.handle('plugins:cleanup-data', async (_event, rawPluginId: unknown) => {
    const pluginId = parsePluginId(rawPluginId, 'plugins:cleanup-data');
    try {
      return await runPluginLifecycleOperationSerially({
        pluginId,
        operation: 'cleanup-data',
        async run() {
          const descriptor = resolvePluginCleanupDescriptor(pluginId);
          if (!descriptor || !declaresCleanableData(descriptor.manifest)) {
            throw new PluginOperationError('source-unavailable', `找不到插件 ${pluginId} 的可信清理声明`, { pluginId });
          }
          const service = getService();
          const knownPlugin = listKnownPluginMetas().find(meta => meta.id === pluginId);
          if (!knownPlugin || knownPlugin.required || service.getInstalledRecord(pluginId)?.installed) {
            throw new PluginOperationError('unknown', '仅能清理已卸载或未安装插件的数据', { pluginId });
          }
          service.ensureKnownPluginRegistered(knownPlugin);
          const controller = new AbortController();
          cleanupAbortControllers.set(pluginId, controller);
          try {
            const result = await cleanupPluginData({
              db: databaseService.getDb(),
              pluginId,
              dataRoot: descriptor.dataRoot,
              dataStorage: descriptor.manifest.dataStorage,
              ownedTables: descriptor.manifest.ownedTables,
              applicationSurfaceSlot: descriptor.manifest.applicationSurfaceSlot,
              signal: controller.signal,
              onStarted: () => beginCleanup(pluginId),
              onProgress: createCleanupProgressReporter(pluginId),
            });
            if (result.status !== 'completed') {
              throw new PluginOperationError('unknown', result.error, { pluginId });
            }
            return { success: true, data: { releasedBytes: result.releasedBytes } };
          } finally {
            endCleanup(pluginId);
          }
        },
      });
    } catch (error) {
      logger.error('[plugins:cleanup-data] failed:', error);
      return { success: false, error: classifyPluginOperationError(error, pluginId) };
    }
  });

  input.ipc.handle('plugins:stop-cleanup', async (_event, rawPluginId: unknown) => {
    const pluginId = parsePluginId(rawPluginId, 'plugins:stop-cleanup');
    const controller = cleanupAbortControllers.get(pluginId);
    if (!controller) return { success: false, error: classifyPluginOperationError(new Error('当前没有正在进行的数据清理'), pluginId) };
    controller.abort();
    return { success: true };
  });

  input.ipc.handle('plugins:reveal-data', async (_event, rawPluginId: unknown) => {
    const pluginId = parsePluginId(rawPluginId, 'plugins:reveal-data');
    try {
      const descriptor = resolvePluginCleanupDescriptor(pluginId);
      if (!descriptor || !declaresCleanableData(descriptor.manifest)) {
        throw new PluginOperationError('source-unavailable', `找不到插件 ${pluginId} 的可信清理声明`, { pluginId });
      }
      // 清理与定位必须指向同一数据根。只把已存在的路径交给 Desktop。
      await input.fileReveal.revealInFileManager(await fs.promises.realpath(descriptor.dataRoot));
      return { success: true };
    } catch (error) {
      logger.error('[plugins:reveal-data] failed:', error);
      return { success: false, error: classifyPluginOperationError(error, pluginId) };
    }
  });

  // 中文说明：内置插件登记由 DatabaseService 的 PluginLifecycleBootstrap 负责；
  // IPC 入口重建工具集合，避免启动早期读取过工具表时继续使用旧 schema。
  await syncPluginRuntimeState({ reinitializeTools: true, runtimeOwner: input.runtimeOwner });

  input.ipc.handle('plugins:list', async () => {
    try {
      return {
        success: true,
        data: listDisplayPluginStates(getService()),
      };
    } catch (error) {
      logger.error('[plugins:list] failed:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  input.ipc.handle('plugins:store-list', async () => {
    try {
      const states = enrichPluginStates(
        listDisplayPluginStates(getService()),
        resolveBundledPluginRoot(),
          state => schedulePluginDataSummary(state, databaseService.getDb(), publishPluginDataChanged),
      );
      const bundledPluginRoot = resolveBundledPluginRoot();
      const bundledPluginIds = bundledPluginRoot
        ? new Set(listBundledPluginManifestIds(bundledPluginRoot))
        : new Set<string>();
      return {
        success: true,
        data: {
          items: buildPluginStoreList(states, { bundledPluginIds }),
          remoteServiceEnabled: remoteSource !== null,
        },
      };
    } catch (error) {
      logger.error('[plugins:store-list] failed:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  input.ipc.handle('plugins:remote-catalog', async () => {
    if (!remoteSource) {
      return { success: true, data: { status: 'disabled' } satisfies PluginRemoteCatalogResult };
    }
    return { success: true, data: await readRemoteCatalog(input.applicationVersion, remoteSource) };
  });

  input.ipc.handle('plugins:get-detail', async (_event, rawPluginId: unknown) => {
    try {
      const pluginId = parsePluginId(rawPluginId, 'plugins:get-detail');
      const directPluginDirs = [
        ...new Set([...readBackendDirectPluginDirsFromEnv(), ...readDirectPluginDirsFromEnv()]),
      ];
      const states = enrichPluginStates(
        listDisplayPluginStates(getService()).filter(item => item.meta.id === pluginId),
        resolveBundledPluginRoot(),
        state => schedulePluginDataSummary(state, databaseService.getDb(), publishPluginDataChanged),
      );
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
          declarationRoot: process.env.LINNYA_RESOLVED_PLUGIN_DECLARATION_ROOT,
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
          trustedCatalogKeys,
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
          run: () => transitionRuntime(async () => {
            const service = getService();
            if (enabled && !backendPluginRegistry.has(pluginId)) {
              throw new PluginOperationError('source-unavailable', '插件后端未加载，不能启用', { pluginId });
            }
            if (!enabled) assertBackendPluginCanDeactivate(pluginId);
            const scopedLifecycle = isTrustedKnowledgeResourceSource(pluginId);
            service.setEnabled(pluginId, enabled, listRegisteredBackendPluginMetas());
            if (!enabled) {
              beginBackendPluginDeactivation(pluginId);
              if (scopedLifecycle) toolRegistry.withdrawPluginTools(pluginId);
            }
            if (!scopedLifecycle)
              await cancelActiveRunsForPluginRuntimeChange({
                pluginId,
                operation: enabled ? '启用' : '禁用',
                supervisor: getRunSupervisor(),
              });
            await syncPluginRuntimeState({
              reinitializeTools: true,
              runtimeOwner: input.runtimeOwner,
            });
            if (enabled) toolRegistry.restorePluginTools(pluginId);
            input.rendererIntegration.publishPluginsChanged();
            return { success: true };
          }),
        });
      } catch (error) {
        logger.error('[plugins:set-enabled] failed:', error);
        return { success: false, error: classifyPluginOperationError(error, typeof rawPluginId === 'string' ? rawPluginId : undefined) };
      }
    }
  );

  input.ipc.handle('plugins:checkRemoteUpdate', async (_event, rawPluginId: unknown) => {
    try {
      if (!remoteSource) {
        throw new PluginOperationError('source-unavailable', '当前版本暂不提供插件远程安装和更新，请使用随包插件');
      }
      const source = remoteSource;
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
        releaseSource: createCatalogReleaseSource(pluginId, source),
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

  /** 远程安装的完整生命周期：串行、下载与激活、运行态同步；IPC 与“有资料自动恢复”共用。 */
  async function runRemotePluginInstall(pluginId: string, source: PluginCatalogSource) {
    return runPluginLifecycleOperationSerially({
      pluginId,
      operation: 'install-from-remote',
      async run() {
        assertPluginCanInstall(pluginId);
        const userPluginRoot = process.env.LINNYA_PLUGIN_ROOT;
        if (!userPluginRoot) {
          throw new PluginOperationError('source-unavailable', '插件目录未初始化，不能远程安装插件', { pluginId });
        }
        const db = getDb();
        const knownPlugins = listKnownPluginMetas();
        // 安装前的运行事实：插件未处于安装状态时，进程里即使还登记着旧版本，它的运行效果也已撤下。
        const wasInstalled = getService().getInstalledRecord(pluginId)?.installed === true;
        const registeredVersion = listRegisteredBackendPluginMetas().find(meta => meta.id === pluginId)?.version;
        assertBackendPluginCanDeactivate(pluginId);
        const scopedLifecycle = isTrustedKnowledgeResourceSource(pluginId);
        const controller = new AbortController();
        remoteInstallAbortControllers.set(pluginId, controller);
        let result: Awaited<ReturnType<typeof installPluginFromRemoteAndActivate>>;
        try {
          result = await installPluginFromRemoteAndActivate({
            db,
            userPluginRoot,
            pluginId,
            releaseSource: createCatalogReleaseSource(pluginId, source),
            installRuntimes: createOfficialRuntimeInstaller(pluginId, userPluginRoot, source),
            // 官方来源只有已验签 catalog；不随包的官方插件首次安装时按下载内容登记。
            allowCatalogListedPlugins: true,
            appVersion: input.applicationVersion,
            rendererUiVersion: RENDERER_UI_VERSION,
            knownPlugins,
            resolveUpgradePlan: resolveDiskPluginUpgradePlan,
            recordDiagnostic: diagnostic => pluginDiagnostics.record(diagnostic),
            signal: controller.signal,
            onProgress: progress => input.rendererIntegration.publishPluginInstallProgress({ pluginId, progress }),
          });
        } finally {
          if (remoteInstallAbortControllers.get(pluginId) === controller) remoteInstallAbortControllers.delete(pluginId);
        }
        if (result.status === 'failed') {
          throwPluginOperationResultFailure(result);
        }
        // 安装前打开过详情会缓存“未安装”时的资料摘要；与随包安装一致，安装后立即失效。
        invalidatePluginDataSummary(pluginId);
        // 没有在运行的旧代码时可直接按新 artifact 登记、不必重启：本次运行从未加载过该插件（首次安装），
        // 或卸载后重新安装了不同版本（旧版本仍在登记表里，但运行效果已撤下，继续沿用会让模块与目录不一致）。
        const firstLoad = result.status === 'installed'
          && (registeredVersion === undefined || (!wasInstalled && registeredVersion !== result.version));
        return transitionRuntime(async () => {
          if (!scopedLifecycle)
            await cancelActiveRunsForPluginRuntimeChange({
              pluginId,
              operation: '安装/升级',
              supervisor: getRunSupervisor(),
            });
          let registeredNow = false;
          if (firstLoad) {
            try {
              resetBackendPluginRegistrationForRuntimeChange();
              ensureBuiltinBackendPluginsRegistered({ applicationVersion: input.applicationVersion, requireComplete: true });
              registeredNow = listRegisteredBackendPluginMetas().some(meta => meta.id === pluginId);
            } catch (error) {
              // 安装已经提交；登记失败只意味着需要重启，下次启动会从 active artifact 注册。
              logger.error('[plugins:installFromRemote] installed but registration refresh failed:', error);
            }
          }
          await syncPluginRuntimeState({
            reinitializeTools: true,
            runtimeOwner: input.runtimeOwner,
          });
          toolRegistry.restorePluginTools(pluginId);
          input.rendererIntegration.publishPluginsChanged();
          return registeredNow && result.status === 'installed' ? { ...result, restartRequired: false } : result;
        });
      },
    });
  }

  input.ipc.handle('plugins:installFromRemote', async (_event, rawPluginId: unknown) => {
    try {
      if (!remoteSource) {
        throw new Error('当前版本暂不提供插件远程安装和更新，请使用随包插件');
      }
      const pluginId = parsePluginId(rawPluginId, 'plugins:installFromRemote');
      return { success: true, data: await runRemotePluginInstall(pluginId, remoteSource) };
    } catch (error) {
      logger.error('[plugins:installFromRemote] failed:', error);
      return { success: false, error: classifyPluginOperationError(error) };
    }
  });

  input.ipc.handle('plugins:cancelRemoteInstall', async (_event, rawPluginId: unknown) => {
    try {
      const pluginId = parsePluginId(rawPluginId, 'plugins:cancelRemoteInstall');
      const controller = remoteInstallAbortControllers.get(pluginId);
      controller?.abort();
      return { success: true, data: { cancelled: controller !== undefined } };
    } catch (error) {
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
        run: () => transitionRuntime(async () => {
          assertPluginCanInstall(pluginId);
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
          invalidatePluginDataSummary(pluginId);
          if (result.restartRequired) return { success: true, data: result };
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
            toolRegistry.restorePluginTools(pluginId);
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
        }),
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
      if (!hasBundledSource && !remoteSource) {
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
          const cleanupDescriptor = deleteData ? resolvePluginCleanupDescriptor(pluginId) : null;
          if (deleteData && (!cleanupDescriptor || !declaresCleanableData(cleanupDescriptor.manifest))) {
            throw new PluginOperationError('source-unavailable', `找不到插件 ${pluginId} 的可信清理声明`, { pluginId });
          }
          const scopedLifecycle = isTrustedKnowledgeResourceSource(pluginId);
          const uninstallRuntime = () => transitionRuntime(async () => {
            assertBackendPluginCanDeactivate(pluginId);
            beginBackendPluginDeactivation(pluginId);
            if (scopedLifecycle) toolRegistry.withdrawPluginTools(pluginId);
            await deactivateStaleBackendPluginRuntimeEffects(
              backendPluginRegistry.getRuntimeEffectRegistrations(getRuntimeEnabledPluginIds())
                .filter(registration => registration.pluginId !== pluginId),
            );
            return uninstallPluginLifecycle({
              db: getDb(), userPluginRoot, pluginId, knownPlugins: listKnownPluginMetas(),
            });
          });
          const result = cleanupDescriptor ? await (async () => {
            const controller = new AbortController();
            try {
              return await uninstallPluginAndDeleteData({
                db: getDb(),
                pluginId,
                dataRoot: cleanupDescriptor.dataRoot,
                dataStorage: cleanupDescriptor.manifest.dataStorage,
                ownedTables: cleanupDescriptor.manifest.ownedTables,
                applicationSurfaceSlot: cleanupDescriptor.manifest.applicationSurfaceSlot,
                signal: controller.signal,
                onStarted: () => {
                  cleanupAbortControllers.set(pluginId, controller);
                  beginCleanup(pluginId);
                },
                onProgress: createCleanupProgressReporter(pluginId),
              }, uninstallRuntime);
            } finally {
              endCleanup(pluginId);
            }
          })() : await uninstallRuntime();
          if (!cleanupDescriptor) invalidatePluginDataSummary(pluginId);
          if (result.status !== 'uninstalled') {
            throwPluginOperationResultFailure(result);
          }
          await transitionRuntime(async () => {
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
          });
          return { success: true, data: { releasedBytes: result.releasedBytes, cleanupIncomplete: result.cleanupIncomplete } };
        },
      });
    } catch (error) {
      logger.error('[plugins:uninstall] failed:', error);
      return { success: false, error: classifyPluginOperationError(error, typeof rawPluginId === 'string' ? rawPluginId : undefined) };
    }
  });

  // 不随包的按需插件：已有资料但未安装（例如从内置该功能的旧版本升级）时，后台从已验签 catalog 自动安装。
  // 远程来源未开放时不做任何事；不阻塞启动，进度与结果照常推给商店。
  if (remoteSource) {
    const source = remoteSource;
    void restoreDeclaredPluginsWithUserData({
      declaredPluginIds: listOnDemandPluginDeclarations(process.env.LINNYA_RESOLVED_PLUGIN_DECLARATION_ROOT),
      shouldRestore: pluginId => {
        const db = getDb();
        const record = getService().getInstalledRecord(pluginId);
        if (record?.installed || record?.userRemoved || hasPendingPluginDataCleanup(db, pluginId)) return false;
        const descriptor = resolvePluginCleanupDescriptor(pluginId);
        return Boolean(descriptor && hasPluginUserData({ db, dataRoot: descriptor.dataRoot, dataStorage: descriptor.manifest.dataStorage }));
      },
      install: async pluginId => {
        await runRemotePluginInstall(pluginId, source);
      },
      recordDiagnostic: ({ pluginId, level, message }) => pluginDiagnostics.record({ level, pluginId, capability: null, message }),
    });
  }
}
