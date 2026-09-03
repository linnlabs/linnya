import { backendPluginRegistry } from '../registry';
import { platformBackendPlugin } from './platform.backend';
import type { PluginId, PluginMeta } from '@app/schemas';
import type { PluginBackendContribution } from '../types';
import type { BackendPluginSkillResourceRootRegistration } from '../registry';
import type Database from 'better-sqlite3';
import path from 'node:path';
import { getRuntimeEnabledPluginIds } from '../pluginRuntimeState';
import { pluginDiagnostics } from '../diagnostics';
import { invalidateSkillCache } from '../../../../features/skills/discovery';
import { validatePluginAgentRequiredSkills } from '../../../../features/skills/agentSkillExposure';
import { replacePluginSkillSourceRoots } from '../../../../features/skills/pluginSkillSources';
import { PluginStateService } from '../../../../features/plugins/infrastructure/sqlite/plugin-state.service';
import { PluginUpgradeRunner } from '../../../../features/plugins/infrastructure/sqlite/plugin-upgrade.runner';
import { activatePluginVersionWithMigrations } from '../../../../features/plugins/install/orchestration/activatePluginVersionWithMigrations';
import { reconcilePluginActiveVersions } from '../../../../features/plugins/install/orchestration/reconcilePluginActiveVersions';
import { PluginActiveVersionService } from '../../../../features/plugins/infrastructure/sqlite/plugin-active-version.service';
import { ensurePluginSkillAvailabilityRegistered } from '../skillAvailability';
import { syncBackendPluginHiddenWorkers } from '../hiddenWorkerPluginRuntime';
import {
  activateDesiredBackendPluginClis,
  deactivateStaleBackendPluginClis,
} from '../pluginCliInvocationRuntime';
import {
  activateDesiredBackendPluginRuntimeEffects,
  deactivateStaleBackendPluginRuntimeEffects,
} from '../runtimeEffectRuntime';
import { syncBackendPluginSandboxProfiles } from '../sandboxProfileRuntime';
import { loadBackendPluginsFromDisk } from '../../../../electron-main/plugins/loader/diskPluginLoader';
import {
  listBundledPluginManifestIds,
  listStagedBundledPluginActivationCandidates,
} from '../../../../electron-main/plugins/loader/pluginRuntimeBootstrap';
import {
  readBackendDirectPluginDirsFromEnv,
  readDirectPluginDirsFromEnv,
} from '../../../../electron-main/plugins/loader/pluginLayout';
import {
  getDocumentTypeBackendHook,
  listDocumentTypeBackendHooks,
  type DocumentTypeBackendHookLookupOptions,
} from '@plugin/backend/documentTypeBackendHook';
import {
  clearBackendPluginIpcHandlersForPlugin,
  registerBackendPluginIpcHandler,
  type BackendPluginIpcHandler,
} from '@plugin/backend/pluginIpcRuntime';
export type BuiltinBackendPluginRegistrationPhase = 'empty' | 'platform-only' | 'complete';

let registrationPhase: BuiltinBackendPluginRegistrationPhase = 'empty';
const diskPluginDirsById = new Map<PluginId, string>();

function registerBackendPluginIfMissing(
  contribution: PluginBackendContribution,
  options: { readonly allowPluginCli?: boolean } = {},
): void {
  if (!backendPluginRegistry.has(contribution.meta.id)) {
    backendPluginRegistry.register(contribution, {
      allowPluginCli: options.allowPluginCli === true,
    });
  }
}

export function resetBackendPluginRegistrationForRuntimeChange(): void {
  backendPluginRegistry.clear();
  diskPluginDirsById.clear();
  registrationPhase = 'empty';
}

function formatPluginIds(pluginIds: readonly PluginId[]): string {
  return pluginIds.join(', ');
}

function registerDiskBackendPlugins(
  options: {
    readonly applicationVersion: string;
    readonly directPluginDirs?: readonly string[];
    readonly trustedDirectPluginDirs?: readonly string[];
    readonly trustedBundledPluginIds?: ReadonlySet<PluginId>;
    readonly onActiveRollback?: (params: {
      readonly pluginId: PluginId;
      readonly failedVersion: string;
      readonly toVersion: string;
    }) => void;
  },
): void {
  const loaded = loadBackendPluginsFromDisk({
    pluginRoot: process.env.LINNYA_PLUGIN_ROOT,
    directPluginDirs: options.directPluginDirs ?? readDirectPluginDirsFromEnv(),
    appVersion: options.applicationVersion,
    onActiveRollback: options.onActiveRollback,
  });

  const trustedDirectPluginDirs = new Set(
    (options.trustedDirectPluginDirs ?? []).map((pluginDir) => path.resolve(pluginDir)),
  );
  for (const item of loaded) {
    // 中文说明：高信任能力跟装配来源走，不跟某个插件 ID 走。开发者明确传入的
    // Backend direct dir，以及当前发行版随包清单中的插件，才允许贡献 Plugin CLI。
    const allowPluginCli = trustedDirectPluginDirs.has(path.resolve(item.pluginDir))
      || options.trustedBundledPluginIds?.has(item.contribution.meta.id) === true;
    registerBackendPluginIfMissing(item.contribution, { allowPluginCli });
    diskPluginDirsById.set(item.contribution.meta.id, item.pluginDir);
  }
}

function syncPluginSkillSourceRoots(enabledIds: ReadonlySet<PluginId> | null): void {
  const resolvedEnabledIds = enabledIds ?? getRuntimeEnabledPluginIds();
  const skillSourceRoots = buildPluginSkillSourceRootsForRuntime({
    enabledIds: resolvedEnabledIds,
    contributionRoots: backendPluginRegistry.getSkillResourceRootRegistrations(resolvedEnabledIds),
    pluginDirsById: diskPluginDirsById,
  });
  for (const registration of backendPluginRegistry.getAgentDefinitionRegistrations(resolvedEnabledIds)) {
    validatePluginAgentRequiredSkills({
      pluginId: registration.pluginId,
      definitions: registration.definitions,
      skillSourceRoots,
    });
  }
  replacePluginSkillSourceRoots(skillSourceRoots);
  invalidateSkillCache();
}

export function buildPluginSkillSourceRootsForRuntime(options: {
  readonly enabledIds: ReadonlySet<PluginId>;
  readonly contributionRoots?: readonly BackendPluginSkillResourceRootRegistration[];
  readonly pluginDirsById: ReadonlyMap<PluginId, string>;
}) {
  return [
    ...Array.from(options.pluginDirsById.entries())
      .filter(([pluginId]) => options.enabledIds.has(pluginId))
      .map(([pluginId, pluginDir]) => ({
      pluginId,
      root: path.join(pluginDir, 'resources', 'skills'),
    })),
    ...(options.contributionRoots ?? [])
      .filter(({ pluginId }) => options.enabledIds.has(pluginId))
      .map(({ pluginId, root }) => ({ pluginId, root })),
  ];
}

function assertBuiltinBackendPluginRegistrationComplete(hasPluginSource: boolean): void {
  if (registrationPhase === 'complete') return;
  throw new Error(
    '[plugin-registry] 后端插件注册尚未完成'
    + ` phase=${registrationPhase}`
    + ` hasPluginSource=${hasPluginSource}`,
  );
}

export function getBuiltinBackendPluginRegistrationPhase(): BuiltinBackendPluginRegistrationPhase {
  return registrationPhase;
}

export function ensureBuiltinBackendPluginsRegistered(
  options: {
    readonly applicationVersion?: string;
    readonly requireComplete?: boolean;
    readonly onActiveRollback?: (params: {
      readonly pluginId: PluginId;
      readonly failedVersion: string;
      readonly toVersion: string;
    }) => void;
  } = {},
): void {
  if (registrationPhase === 'complete') return;
  ensurePluginSkillAvailabilityRegistered();
  const backendDirectPluginDirs = readBackendDirectPluginDirsFromEnv();
  const directPluginDirs = [...new Set([
    ...backendDirectPluginDirs,
    ...readDirectPluginDirsFromEnv(),
  ])];
  const hasPluginSource = !!process.env.LINNYA_PLUGIN_ROOT || directPluginDirs.length > 0;
  registerBackendPluginIfMissing(platformBackendPlugin);

  // 没有外部插件源是合法的纯 Core 运行面；Core 不维护“本应存在”的插件清单。
  if (!hasPluginSource) {
    registrationPhase = 'complete';
    return;
  }

  const applicationVersion = options.applicationVersion?.trim();
  if (!applicationVersion) {
    // 主进程启动壳可能先枚举平台 meta；真正加载外部代码必须等应用版本冻结后再做兼容校验。
    registrationPhase = 'platform-only';
    if (options.requireComplete) {
      assertBuiltinBackendPluginRegistrationComplete(hasPluginSource);
    }
    return;
  }

  const bundledPluginRoot = process.env.LINNYA_RESOLVED_BUNDLED_PLUGIN_ROOT
    ?? process.env.LINNYA_BUNDLED_PLUGIN_ROOT;
  const trustedBundledPluginIds = new Set<PluginId>(
    bundledPluginRoot ? listBundledPluginManifestIds(bundledPluginRoot) : [],
  );
  registerDiskBackendPlugins({
    applicationVersion,
    directPluginDirs,
    trustedDirectPluginDirs: backendDirectPluginDirs,
    trustedBundledPluginIds,
    onActiveRollback: options.onActiveRollback,
  });
  registrationPhase = 'complete';
}

function readInstalledPluginIds(
  db: Database.Database,
  metas: readonly PluginMeta[] = backendPluginRegistry.listMeta(),
): ReadonlySet<PluginId> {
  const stateService = new PluginStateService(db);
  const installedIds = new Set<PluginId>();
  for (const meta of metas) {
    const record = stateService.getInstalledRecord(meta.id);
    if (record?.installed) {
      installedIds.add(meta.id);
    }
  }
  return installedIds;
}

function applyRegisteredPluginSchemas(db: Database.Database, installedIds: ReadonlySet<PluginId>): void {
  const providers = backendPluginRegistry.getSchemaProviders(installedIds);
  if (providers.length === 0) {
    console.log('[PluginLifecycleBootstrap] No plugin schema providers to apply.');
    return;
  }

  console.log(`[PluginLifecycleBootstrap] Applying ${providers.length} plugin schema provider(s)...`);
  const transaction = db.transaction(() => {
    for (const provider of providers) {
      console.log(`[PluginLifecycleBootstrap] Applying schema from plugin provider: ${provider.name}`);
      for (const ddl of provider.getSchema()) {
        try {
          db.exec(ddl);
        } catch (error) {
          console.error(`[PluginLifecycleBootstrap] Failed to execute DDL from ${provider.name}:`, error);
          console.error(`[PluginLifecycleBootstrap] DDL statement:\n${ddl}`);
          throw error;
        }
      }
    }
  });
  transaction();
}

function runRegisteredPluginLifecycle(
  db: Database.Database,
  installedIds: ReadonlySet<PluginId>,
  applicationVersion: string,
): void {
  const plans = backendPluginRegistry.getLifecyclePlans(installedIds);
  console.log(
    `[PluginLifecycleBootstrap] Installed plugin ids: ${formatPluginIds(Array.from(installedIds)) || '(none)'}.`,
  );
  console.log(
    `[PluginLifecycleBootstrap] Lifecycle plans: ${plans.map((plan) => `${plan.pluginId}@${plan.targetVersion}/schema${latestMigrationVersion(plan.migrations)}`).join(', ') || '(none)'}.`,
  );
  if (plans.length === 0) {
    console.log('[PluginLifecycleBootstrap] No plugin lifecycle plans to apply.');
    return;
  }

  const runner = new PluginUpgradeRunner(db, {
    appVersion: applicationVersion,
    recordDiagnostic: (diagnostic) => {
      pluginDiagnostics.record(diagnostic);
    },
  });
  for (const plan of plans) {
    console.log(
      `[PluginLifecycleBootstrap] Running ${plan.pluginId} plugin lifecycle plan `
      + `(target=${plan.targetVersion}, migrations=[${plan.migrations.map((migration) => migration.version).join(',')}], `
      + `ownedTables=${plan.ownedTables.length}).`,
    );
    const result = runner.run(plan);
    if (result.status === 'upgraded') {
      console.log(
        `[PluginLifecycleBootstrap] Applied ${plan.pluginId} plugin lifecycle ${result.fromVersion} -> ${result.toVersion}; schema v${result.migrationResult.toVersion}.`,
      );
      continue;
    }
    if (result.status === 'skipped') {
      console.log(`[PluginLifecycleBootstrap] ${plan.pluginId} plugin lifecycle skipped: ${result.reason}.`);
    } else if (result.status === 'incompatible') {
      console.warn(`[PluginLifecycleBootstrap] ${plan.pluginId} plugin lifecycle incompatible: ${result.reason}.`);
    } else {
      console.error(`[PluginLifecycleBootstrap] ${plan.pluginId} plugin lifecycle failed: ${result.error}.`);
    }
  }
}

function latestMigrationVersion(migrations: readonly { readonly version: number }[]): number {
  return migrations.length === 0 ? 0 : migrations[migrations.length - 1]?.version ?? 0;
}

function activateStagedBundledPluginVersions(
  db: Database.Database,
  applicationVersion: string,
): void {
  const bundledPluginRoot = process.env.LINNYA_RESOLVED_BUNDLED_PLUGIN_ROOT ?? process.env.LINNYA_BUNDLED_PLUGIN_ROOT;
  const userPluginRoot = process.env.LINNYA_PLUGIN_ROOT;
  if (!bundledPluginRoot || !userPluginRoot) {
    return;
  }

  const candidates = listStagedBundledPluginActivationCandidates({
    bundledPluginRoot,
    userPluginRoot,
  });
  if (candidates.length === 0) {
    return;
  }

  const stateService = new PluginStateService(db);
  stateService.ensureBuiltinInstalled([platformBackendPlugin.meta]);
  let activatedAny = false;
  for (const candidate of candidates) {
    const previousRecord = stateService.getInstalledRecord(candidate.pluginId);
    const wasEnabled = new Set(stateService.getEnabledIds()).has(candidate.pluginId);
    const loaded = loadBackendPluginsFromDisk({
      directPluginDirs: [candidate.pluginDir],
      appVersion: applicationVersion,
    });
    const contribution = loaded.find((item) => item.contribution.meta.id === candidate.pluginId)?.contribution;
    if (!contribution) {
      pluginDiagnostics.record({
        level: 'error',
        pluginId: candidate.pluginId,
        capability: 'migration',
        message: `随包插件 ${candidate.pluginId}@${candidate.version} backend 加载失败，未切换 active 指针`,
      });
      continue;
    }

    stateService.ensureBuiltinInstalled([
      platformBackendPlugin.meta,
      contribution.meta,
    ]);
    try {
      stateService.setInstalled(contribution.meta.id, true, [
        platformBackendPlugin.meta,
        contribution.meta,
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pluginDiagnostics.record({
        level: 'error',
        pluginId: contribution.meta.id,
        capability: 'migration',
        message: `随包插件 ${contribution.meta.id}@${contribution.meta.version} 安装状态登记失败: ${message}`,
      });
      continue;
    }

    const result = activatePluginVersionWithMigrations({
      db,
      userPluginRoot,
      pluginId: contribution.meta.id,
      version: contribution.meta.version,
      appVersion: applicationVersion,
      upgradePlan: {
        pluginId: contribution.meta.id,
        targetVersion: contribution.meta.version,
        compatMin: contribution.meta.compatMin,
        ownedTables: contribution.ownedTables ?? [],
        migrations: contribution.pluginMigrations ?? [],
      },
      recordDiagnostic: (diagnostic) => pluginDiagnostics.record(diagnostic),
    });
    if (result.status === 'activated') {
      activatedAny = true;
      if (previousRecord?.installed && !wasEnabled) {
        stateService.setEnabled(contribution.meta.id, false, [
          platformBackendPlugin.meta,
          contribution.meta,
        ]);
      }
      console.log(
        `[PluginLifecycleBootstrap] Activated staged bundled plugin ${result.pluginId}@${result.version}.`,
      );
      continue;
    }
    if (!previousRecord?.installed) {
      stateService.setInstalled(contribution.meta.id, false, [
        platformBackendPlugin.meta,
        contribution.meta,
      ]);
    } else if (!wasEnabled) {
      stateService.setEnabled(contribution.meta.id, false, [
        platformBackendPlugin.meta,
        contribution.meta,
      ]);
    }
    pluginDiagnostics.record({
      level: 'error',
      pluginId: candidate.pluginId,
      capability: 'migration',
      message: `随包插件 ${candidate.pluginId}@${candidate.version} 激活失败: ${result.error}`,
    });
  }
  if (activatedAny) {
    // 中文说明：随包升级会在启动期切换 active.json。若 registry 之前已经因
    // 工具/agent/IPC 枚举加载过旧 active 插件，必须丢弃旧 contribution，
    // 否则后续 IPC 会继续调用旧版本 handler。
    resetBackendPluginRegistrationForRuntimeChange();
  }
}

export function bootstrapBuiltinPluginLifecycle(
  db: Database.Database,
  applicationVersion: string,
): void {
  // 中文说明：随包 seed 只复制版本目录，不提前切 active；这里在核心 DB 表
  // 就绪后先用 staged artifact 跑迁移，成功后再写 active.json，避免启动窗口内
  // 出现「active 指到新代码但 schema 仍是旧版」。
  activateStagedBundledPluginVersions(db, applicationVersion);
  const userPluginRoot = process.env.LINNYA_PLUGIN_ROOT;
  if (userPluginRoot) {
    reconcilePluginActiveVersions({
      db,
      userPluginRoot,
      recordDiagnostic: (diagnostic) => pluginDiagnostics.record({
        level: diagnostic.level,
        pluginId: diagnostic.pluginId,
        capability: 'migration',
        message: diagnostic.message,
      }),
    });
  }
  ensureBuiltinBackendPluginsRegistered({
    applicationVersion,
    requireComplete: true,
    onActiveRollback: ({ pluginId, toVersion }) => {
      new PluginActiveVersionService(db).markActive({
        pluginId,
        activeVersion: toVersion,
        previousVersion: null,
      });
    },
  });
  const stateService = new PluginStateService(db);
  const metas = backendPluginRegistry.listMeta();

  // 中文说明：核心迁移完成后才登记内置插件；此时 installed_plugins/plugin_migrations 已存在。
  stateService.ensureBuiltinInstalled(metas.filter((meta) => meta.builtin));
  const installedIds = readInstalledPluginIds(db, metas);
  applyRegisteredPluginSchemas(db, installedIds);
  runRegisteredPluginLifecycle(db, installedIds, applicationVersion);
}

export function listRegisteredBackendPluginMetas() {
  ensureBuiltinBackendPluginsRegistered();
  return backendPluginRegistry.listMeta();
}

function resolveEnabledIds(enabledIds?: ReadonlySet<PluginId> | null): ReadonlySet<PluginId> | null {
  return enabledIds === undefined ? getRuntimeEnabledPluginIds() : enabledIds;
}

export function getRegisteredToolClasses(enabledIds?: ReadonlySet<PluginId> | null) {
  ensureBuiltinBackendPluginsRegistered({ requireComplete: true });
  return backendPluginRegistry.getToolClasses(resolveEnabledIds(enabledIds));
}

export function getRegisteredToolContextDecorators(enabledIds?: ReadonlySet<PluginId> | null) {
  ensureBuiltinBackendPluginsRegistered({ requireComplete: true });
  return backendPluginRegistry.getToolContextDecorators(resolveEnabledIds(enabledIds));
}

export function getRegisteredToolContextBindingMigrators(enabledIds?: ReadonlySet<PluginId> | null) {
  ensureBuiltinBackendPluginsRegistered({ requireComplete: true });
  return backendPluginRegistry.getToolContextBindingMigrators(resolveEnabledIds(enabledIds));
}

export function getRegisteredAgentFenceDescriptors(enabledIds?: ReadonlySet<PluginId> | null) {
  ensureBuiltinBackendPluginsRegistered({ requireComplete: true });
  return backendPluginRegistry.getAgentFenceRegistrations(resolveEnabledIds(enabledIds))
    .map((registration) => registration.descriptor);
}

export function getBackendPluginRegistryRevision(): number {
  ensureBuiltinBackendPluginsRegistered({ requireComplete: true });
  return backendPluginRegistry.getRevision();
}

export function registerRegisteredBackendPluginIpcHandlers(serviceManager: unknown): void {
  ensureBuiltinBackendPluginsRegistered({ requireComplete: true });
  const clearedPluginIds = new Set<string>();
  for (const registration of backendPluginRegistry.getIpcRegistrations(resolveEnabledIds())) {
    const declaredChannels = new Set(registration.channels);
    const registeredChannels = new Set<string>();
    if (!clearedPluginIds.has(registration.pluginId)) {
      clearBackendPluginIpcHandlersForPlugin(registration.pluginId);
      clearedPluginIds.add(registration.pluginId);
    }
    registration.register(serviceManager, (
      pluginId: string,
      channel: string,
      handler: BackendPluginIpcHandler,
    ) => {
      if (pluginId !== registration.pluginId) {
        throw new Error(
          `[plugin-registry] IPC contribution pluginId 不一致: expected=${registration.pluginId}, actual=${pluginId}`,
        );
      }
      registeredChannels.add(channel);
      registerBackendPluginIpcHandler(pluginId, channel, handler);
    });

    if (registration.source === 'legacy') {
      continue;
    }

    const undeclared = Array.from(registeredChannels).filter((channel) => !declaredChannels.has(channel));
    const missing = Array.from(declaredChannels).filter((channel) => !registeredChannels.has(channel));
    if (undeclared.length > 0 || missing.length > 0) {
      throw new Error(
        `[plugin-registry] IPC contribution 声明与注册不一致: ${registration.pluginId}`
        + ` undeclared=[${undeclared.join(',')}] missing=[${missing.join(',')}]`,
      );
    }
  }
}

export function syncRegisteredBackendPluginSandboxProfiles(enabledIds?: ReadonlySet<PluginId> | null): void {
  ensureBuiltinBackendPluginsRegistered({ requireComplete: true });
  syncBackendPluginSandboxProfiles(
    backendPluginRegistry.getSandboxProfileRegistrations(resolveEnabledIds(enabledIds)),
  );
}

export async function syncRegisteredBackendPluginRuntimeResources(
  enabledIds?: ReadonlySet<PluginId> | null,
): Promise<void> {
  ensureBuiltinBackendPluginsRegistered({ requireComplete: true });
  const resolvedEnabledIds = resolveEnabledIds(enabledIds);
  syncPluginSkillSourceRoots(resolvedEnabledIds);
  const runtimeEffectRegistrations = backendPluginRegistry.getRuntimeEffectRegistrations(resolvedEnabledIds);
  const pluginCliRegistrations = backendPluginRegistry.getPluginCliRegistrations(resolvedEnabledIds);
  await deactivateStaleBackendPluginClis(pluginCliRegistrations);
  await deactivateStaleBackendPluginRuntimeEffects(runtimeEffectRegistrations);
  syncBackendPluginSandboxProfiles(
    backendPluginRegistry.getSandboxProfileRegistrations(resolvedEnabledIds),
  );
  await syncBackendPluginHiddenWorkers(
    backendPluginRegistry.getHiddenWorkerRegistrations(resolvedEnabledIds),
  );
  await activateDesiredBackendPluginRuntimeEffects(runtimeEffectRegistrations);
  activateDesiredBackendPluginClis(pluginCliRegistrations);
}

export function getRegisteredBackendPluginCli(
  pluginId: PluginId,
): import('../registry').BackendPluginCliRegistration | undefined {
  ensureBuiltinBackendPluginsRegistered({ requireComplete: true });
  return backendPluginRegistry
    .getPluginCliRegistrations(resolveEnabledIds())
    .find(registration => registration.pluginId === pluginId);
}

export function listRegisteredBackendPluginClis(): readonly import('../registry').BackendPluginCliRegistration[] {
  ensureBuiltinBackendPluginsRegistered({ requireComplete: true });
  return backendPluginRegistry.getPluginCliRegistrations(resolveEnabledIds());
}

/** 只供受管 launcher 清理旧版本精确文件名；不代表当前 enabled 状态。 */
export function listAllBackendPluginCliIdsForLauncherCleanup(): readonly PluginId[] {
  ensureBuiltinBackendPluginsRegistered({ requireComplete: true });
  return backendPluginRegistry
    .getPluginCliRegistrations(null)
    .map(registration => registration.pluginId);
}

export function getRegisteredBackendPluginIpcChannels(
  pluginId: PluginId,
  enabledIds?: ReadonlySet<PluginId> | null
) {
  ensureBuiltinBackendPluginsRegistered({ requireComplete: true });
  return backendPluginRegistry.getIpcChannelsForPlugin(pluginId, resolveEnabledIds(enabledIds));
}

export function getRegisteredBackendPluginRendererPushChannels(
  pluginId: PluginId,
  enabledIds?: ReadonlySet<PluginId> | null
) {
  ensureBuiltinBackendPluginsRegistered({ requireComplete: true });
  return backendPluginRegistry.getRendererPushChannelsForPlugin(pluginId, resolveEnabledIds(enabledIds));
}

export function getRegisteredAgentDefinitions(enabledIds?: ReadonlySet<PluginId>) {
  ensureBuiltinBackendPluginsRegistered({ requireComplete: true });
  return backendPluginRegistry.getAgentDefinitions(resolveEnabledIds(enabledIds));
}

/**
 * 读取所有已注册插件贡献的 AgentDefinition，不读取 runtime enabled 状态。
 *
 * 中文说明：这个入口只服务静态目录、配置校验和测试夹具。真实运行期解析
 * 必须使用 `getRegisteredAgentDefinitions()`，由平台统一读取 SQLite enabled 状态。
 */
export function getAllRegisteredAgentDefinitionsForStaticCatalog() {
  ensureBuiltinBackendPluginsRegistered({ requireComplete: true });
  return backendPluginRegistry.getAgentDefinitions(null);
}

export function getRegisteredSubagentTypes(enabledIds?: ReadonlySet<PluginId> | null) {
  ensureBuiltinBackendPluginsRegistered({ requireComplete: true });
  return backendPluginRegistry.getSubagentTypes(resolveEnabledIds(enabledIds));
}

export function getRegisteredDocumentTypeBackendHook(
  docType: string,
  options?: DocumentTypeBackendHookLookupOptions
) {
  ensureBuiltinBackendPluginsRegistered({ requireComplete: true });
  return getDocumentTypeBackendHook(docType, options);
}

export function listRegisteredDocumentTypeBackendHooks(
  options?: DocumentTypeBackendHookLookupOptions
) {
  ensureBuiltinBackendPluginsRegistered({ requireComplete: true });
  return listDocumentTypeBackendHooks(options);
}
