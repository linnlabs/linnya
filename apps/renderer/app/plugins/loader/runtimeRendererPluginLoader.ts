import { evaluateRendererUiCompatibility } from '@app/schemas';
import { RENDERER_UI_VERSION } from '@linnya/renderer-ui/version';
import {
  rendererUiPluginRuntimeEntries,
} from '../../../../../scripts/build/renderer-ui-runtime/rendererUiRuntimeEntryCatalog.mjs';

import type { RendererPluginContribution } from '../types';
import {
  activateRendererPlugin,
  deactivateRendererPlugin,
  describeRendererPluginRegistryForDiagnostics,
  getRendererPluginContribution,
  hasRendererPlugin,
  listActiveRendererPluginIds,
  registerRendererPlugin,
  unregisterRendererPluginContribution,
} from '../registry';

const rendererPluginLoaderLogPrefix = '[renderer-plugin-loader]';
const requiredPluginSdkHostModuleIds = [
  '@plugin/renderer/aiInvocationPort',
  '@plugin/renderer/composerCommandPort',
  '@plugin/renderer/conversationSubrunInvocationPort',
  '@plugin/renderer/documentMutationPort',
  '@plugin/renderer/documentReferenceRuntimePort',
  '@plugin/renderer/exportArtifact',
  '@plugin/renderer/imageAssetSource',
  '@plugin/renderer/interactiveTool',
  '@plugin/renderer/pageContextProvider',
  '@plugin/renderer/pluginDocumentCreationPort',
  '@plugin/renderer/pluginIpcClient',
  '@plugin/renderer/pluginPushClient',
  '@plugin/renderer/refId',
  '@plugin/renderer/referenceLinkUi',
  '@plugin/renderer/referenceRuntime',
  '@plugin/renderer/settingsContribution',
  '@plugin/renderer/structuredContextRequirementPort',
  '@plugin/renderer/subrunToolUi',
  '@plugin/renderer/textMeasurement',
  '@plugin/renderer/toolRefreshPort',
  '@plugin/renderer/workspaceNavigation',
  '@plugin/renderer/workspaceRuntime',
] as const;
const requiredHostModuleIds: readonly string[] = [
  ...requiredPluginSdkHostModuleIds,
  ...rendererUiPluginRuntimeEntries.map((entry) => entry.hostModuleKey).filter(
    (moduleKey): moduleKey is string => moduleKey !== null,
  ),
];

interface RendererPluginEntry {
  readonly pluginId: string;
  readonly version: string;
  readonly rendererUiRange: string;
  readonly entryUrl: string;
  readonly cssUrls: readonly string[];
  readonly sourceKind?: string;
  readonly pluginDir?: string;
  readonly entryPath?: string;
}

type RendererEntriesResult =
  | { readonly success: true; readonly data: readonly RendererPluginEntry[] }
  | { readonly success: false; readonly error?: string };

export interface RuntimeRendererPluginLoaderOptions {
  readonly rendererEntriesApi?: () => Promise<unknown>;
  readonly importEntry?: (entryUrl: string) => Promise<unknown>;
  readonly installHostModules?: () => void | Promise<void>;
}

type RendererPluginLoadPhase =
  | 'entry-start'
  | 'compatibility-admission'
  | 'reuse-existing'
  | 'import-start'
  | 'import-success'
  | 'contribution-validate'
  | 'contribution-validated'
  | 'register-start'
  | 'register-success'
  | 'css-inject'
  | 'activate-start'
  | 'activate-success';

interface RendererPluginEntryDiagnostics {
  readonly pluginId: string;
  readonly version: string;
  readonly rendererUiRange: string;
  readonly entryUrl: string;
  readonly cssUrls: readonly string[];
  readonly cssCount: number;
  readonly sourceKind: string | null;
  readonly pluginDir: string | null;
  readonly entryPath: string | null;
}

interface RendererPluginModuleExportDiagnostics {
  readonly exportType: string;
  readonly exportKeys: readonly string[];
  readonly hasRendererPlugin: boolean;
  readonly hasDefault: boolean;
  readonly rendererPluginLooksLikeContribution: boolean;
  readonly defaultLooksLikeContribution: boolean;
}

interface RendererPluginContributionDiagnostics {
  readonly meta: {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly builtin?: boolean;
  };
  readonly documentTypes: readonly {
    readonly nodeType: string;
    readonly activeDocumentType: string;
    readonly fileSessionType?: string;
    readonly createRequestType: string;
    readonly label: string;
  }[];
  readonly toolCards: readonly string[];
  readonly documentActionMenus: readonly string[];
  readonly documentRuntimeLoaders: readonly string[];
  readonly conversationAgentChoices: readonly string[];
  readonly conversationInput: {
    readonly referenceKinds: readonly string[];
    readonly referenceProviders: readonly string[];
    readonly accessories: readonly string[];
  } | null;
  readonly subrunWorkers: readonly string[];
  readonly stylesheets: readonly string[];
}

interface RendererPluginLoadDiagnostics {
  phase: RendererPluginLoadPhase;
  readonly entry: RendererPluginEntryDiagnostics;
  readonly registryBefore: ReturnType<typeof describeRendererPluginRegistryForDiagnostics>;
  moduleExports: RendererPluginModuleExportDiagnostics;
  contribution: RendererPluginContributionDiagnostics | null;
}

interface RendererPluginSyncFailureDiagnostics {
  readonly entry: RendererPluginEntryDiagnostics;
  readonly phase: RendererPluginLoadPhase;
  readonly moduleExports: RendererPluginModuleExportDiagnostics;
  readonly contribution: RendererPluginContributionDiagnostics | null;
  readonly registryBefore: ReturnType<typeof describeRendererPluginRegistryForDiagnostics>;
  readonly registryAfterCleanup: ReturnType<typeof describeRendererPluginRegistryForDiagnostics>;
  readonly registeredBefore: boolean;
  readonly activeBefore: boolean;
  readonly registeredAfterCleanup: boolean;
  readonly activeAfterCleanup: boolean;
  readonly error: Record<string, unknown>;
}

interface RendererPluginSyncDiagnostics {
  readonly processedPluginIds: readonly string[];
  readonly deactivatedPluginIds: readonly string[];
  readonly failures: readonly RendererPluginSyncFailureDiagnostics[];
}

export interface RuntimeRendererPluginLoaderDiagnostics {
  readonly runId: number;
  readonly status: 'idle' | 'running' | 'success' | 'failed';
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly hostModules: Record<string, unknown> | null;
  readonly registryBeforeEntriesApi: ReturnType<typeof describeRendererPluginRegistryForDiagnostics> | null;
  readonly entries: readonly RendererPluginEntryDiagnostics[];
  readonly registryAfterSync: ReturnType<typeof describeRendererPluginRegistryForDiagnostics> | null;
  readonly sync: RendererPluginSyncDiagnostics | null;
  readonly error: Record<string, unknown> | null;
}

let rendererPluginLoaderRunId = 0;
let rendererPluginSyncTail: Promise<void> = Promise.resolve();
let latestRendererPluginLoaderDiagnostics: RuntimeRendererPluginLoaderDiagnostics = {
  runId: 0,
  status: 'idle',
  startedAt: null,
  completedAt: null,
  hostModules: null,
  registryBeforeEntriesApi: null,
  entries: [],
  registryAfterSync: null,
  sync: null,
  error: null,
};

declare global {
  // 中文说明：文档打开守卫和 registry 不能反向 import loader，否则会形成环依赖。
  // 这里把最近一次 loader 诊断发布到全局只用于调试日志，不参与业务判断。
  var __LINNYA_RENDERER_PLUGIN_LOADER_DIAGNOSTICS__: RuntimeRendererPluginLoaderDiagnostics | undefined;
}

function publishRendererPluginLoaderDiagnostics(): void {
  globalThis.__LINNYA_RENDERER_PLUGIN_LOADER_DIAGNOSTICS__ = latestRendererPluginLoaderDiagnostics;
}

export function getRuntimeRendererPluginLoaderDiagnostics(): RuntimeRendererPluginLoaderDiagnostics {
  return latestRendererPluginLoaderDiagnostics;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isRendererPluginEntry(value: unknown): value is RendererPluginEntry {
  if (!isRecord(value)) return false;
  return typeof value.pluginId === 'string' &&
    typeof value.version === 'string' &&
    typeof value.rendererUiRange === 'string' &&
    typeof value.entryUrl === 'string' &&
    Array.isArray(value.cssUrls) &&
    value.cssUrls.every((item) => typeof item === 'string');
}

function parseRendererEntriesResult(value: unknown): RendererEntriesResult {
  if (!isRecord(value)) {
    return { success: false, error: 'renderer 插件入口返回值不是对象' };
  }
  if (value.success !== true) {
    return {
      success: false,
      error: typeof value.error === 'string' ? value.error : 'renderer 插件入口读取失败',
    };
  }
  if (!Array.isArray(value.data) || !value.data.every(isRendererPluginEntry)) {
    return { success: false, error: 'renderer 插件入口结构不符合约定' };
  }
  return { success: true, data: value.data };
}

function describeRendererPluginEntry(entry: RendererPluginEntry): RendererPluginEntryDiagnostics {
  return {
    pluginId: entry.pluginId,
    version: entry.version,
    rendererUiRange: entry.rendererUiRange,
    entryUrl: entry.entryUrl,
    cssUrls: entry.cssUrls,
    cssCount: entry.cssUrls.length,
    sourceKind: entry.sourceKind ?? null,
    pluginDir: entry.pluginDir ?? null,
    entryPath: entry.entryPath ?? null,
  };
}

function summarizeRendererPluginEntry(entry: RendererPluginEntryDiagnostics): Record<string, unknown> {
  return {
    pluginId: entry.pluginId,
    version: entry.version,
    rendererUiRange: entry.rendererUiRange,
    sourceKind: entry.sourceKind,
    entryUrl: entry.entryUrl,
    cssCount: entry.cssCount,
    pluginDir: entry.pluginDir,
    entryPath: entry.entryPath,
  };
}

function describeUnknownRendererEntriesResult(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {
      resultType: typeof value,
      isArray: Array.isArray(value),
    };
  }

  const data = value.data;
  return {
    resultType: 'object',
    keys: Object.keys(value).sort(),
    success: value.success,
    error: value.error,
    dataType: Array.isArray(data) ? 'array' : typeof data,
    dataLength: Array.isArray(data) ? data.length : undefined,
  };
}

function isRendererPluginContribution(value: unknown): value is RendererPluginContribution {
  if (!isRecord(value) || !isRecord(value.meta)) {
    return false;
  }
  return typeof value.meta.id === 'string' &&
    typeof value.meta.name === 'string' &&
    typeof value.meta.version === 'string' &&
    typeof value.meta.description === 'string' &&
    typeof value.meta.developer === 'string' &&
    (
      value.stylesheets === undefined ||
      (
        Array.isArray(value.stylesheets) &&
        value.stylesheets.every((item) => typeof item === 'string')
      )
    );
}

function readRendererPluginContribution(moduleExports: unknown): RendererPluginContribution | null {
  if (!isRecord(moduleExports)) {
    return null;
  }

  const candidate = moduleExports.rendererPlugin ?? moduleExports.default;
  return isRendererPluginContribution(candidate) ? candidate : null;
}

function describeRendererPluginModuleExports(moduleExports: unknown): RendererPluginModuleExportDiagnostics {
  if (!isRecord(moduleExports)) {
    return {
      exportType: typeof moduleExports,
      exportKeys: [],
      hasRendererPlugin: false,
      hasDefault: false,
      rendererPluginLooksLikeContribution: false,
      defaultLooksLikeContribution: false,
    };
  }

  return {
    exportType: 'object',
    exportKeys: Object.keys(moduleExports).sort(),
    hasRendererPlugin: moduleExports.rendererPlugin !== undefined,
    hasDefault: moduleExports.default !== undefined,
    rendererPluginLooksLikeContribution: isRendererPluginContribution(moduleExports.rendererPlugin),
    defaultLooksLikeContribution: isRendererPluginContribution(moduleExports.default),
  };
}

function describeRendererPluginContribution(
  contribution: RendererPluginContribution,
): RendererPluginContributionDiagnostics {
  return {
    meta: {
      id: contribution.meta.id,
      name: contribution.meta.name,
      version: contribution.meta.version,
      builtin: contribution.meta.builtin,
    },
    documentTypes: (contribution.documentTypes ?? []).map((documentType) => ({
      nodeType: documentType.nodeType,
      activeDocumentType: documentType.activeDocumentType,
      fileSessionType: documentType.fileSessionType,
      createRequestType: documentType.createRequestType,
      label: documentType.label,
    })),
    toolCards: Object.keys(contribution.toolCards ?? {}).sort(),
    documentActionMenus: (contribution.documentActionMenus ?? [])
      .map((item) => item.activeDocumentType)
      .sort(),
    documentRuntimeLoaders: (contribution.documentRuntimeLoaders ?? [])
      .map((item) => item.activeDocumentType)
      .sort(),
    conversationAgentChoices: (contribution.conversationAgentChoices ?? [])
      .map((item) => item.id)
      .sort(),
    conversationInput: contribution.conversationInput
      ? {
          referenceKinds: contribution.conversationInput.referenceKinds
            .map(kind => kind.kind)
            .sort(),
          referenceProviders: contribution.conversationInput.referenceProviders
            .map(provider => provider.id)
            .sort(),
          accessories: (contribution.conversationInput.accessories ?? [])
            .map(accessory => accessory.id)
            .sort(),
        }
      : null,
    subrunWorkers: (contribution.subrunWorkers ?? []).map(worker => worker.id).sort(),
    stylesheets: contribution.stylesheets ?? [],
  };
}

function describeRendererPluginHostModules(): Record<string, unknown> {
  const hostModules = window.__LINNYA_RENDERER_PLUGIN_HOST_MODULES__;
  if (!hostModules) {
    return {
      installed: false,
      hasVue: false,
      hasPinia: false,
      moduleCount: 0,
      moduleKeys: [],
      missingRequiredModules: requiredHostModuleIds,
    };
  }

  const moduleKeys = Object.keys(hostModules.modules).sort();
  const moduleKeySet = new Set(moduleKeys);
  return {
    installed: true,
    hasVue: !!hostModules.vue,
    hasPinia: !!hostModules.pinia,
    moduleCount: moduleKeys.length,
    moduleKeys,
    missingRequiredModules: requiredHostModuleIds.filter((moduleId) => !moduleKeySet.has(moduleId)),
  };
}

function describeRendererPluginError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return {
    name: typeof error,
    message: String(error),
  };
}

function summarizeRendererPluginError(error: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!error) return null;
  return {
    name: error.name ?? null,
    message: error.message ?? null,
  };
}

function summarizeRendererRegistry(
  registry: ReturnType<typeof describeRendererPluginRegistryForDiagnostics>,
): Record<string, unknown> {
  return {
    registeredPluginIds: registry.registeredPluginIds,
    activePluginIds: registry.activePluginIds,
    documentTypes: registry.documentTypes.map((documentType) => ({
      pluginId: documentType.pluginId,
      nodeType: documentType.nodeType,
      activeDocumentType: documentType.activeDocumentType,
    })),
    conversationInputs: registry.conversationInputs,
  };
}

function hasPluginInRegistrySnapshot(
  snapshot: ReturnType<typeof describeRendererPluginRegistryForDiagnostics>,
  pluginId: string,
): boolean {
  return snapshot.registeredPluginIds.includes(pluginId);
}

function hasActivePluginInRegistrySnapshot(
  snapshot: ReturnType<typeof describeRendererPluginRegistryForDiagnostics>,
  pluginId: string,
): boolean {
  return snapshot.activePluginIds.includes(pluginId);
}

function logRendererPluginLoadStep(
  phase: RendererPluginLoadPhase,
  entry: RendererPluginEntry,
  details: Record<string, unknown> = {},
): void {
  console.info(`${rendererPluginLoaderLogPrefix} ${phase}`, {
    entry: describeRendererPluginEntry(entry),
    ...details,
  });
}

function assertRendererUiCompatibility(entry: RendererPluginEntry): void {
  const result = evaluateRendererUiCompatibility(RENDERER_UI_VERSION, entry.rendererUiRange);
  if (result.compatible) return;

  if (result.reason === 'invalid-host-version') {
    throw new Error(`Host Renderer UI 版本无效: ${result.hostVersion}`);
  }
  if (result.reason === 'invalid-range') {
    throw new Error(
      `${entry.pluginId}@${entry.version} 的 compat.rendererUi 无效: ${result.range}`,
    );
  }
  throw new Error(
    `${entry.pluginId}@${entry.version} 要求 Renderer UI ${result.range}，当前为 ${result.hostVersion}`,
  );
}

function ensureCssLink(pluginId: string, href: string): void {
  const existingLinks = Array.from(document.querySelectorAll('link[data-linnya-plugin-css]'));
  for (const existing of existingLinks) {
    if (existing instanceof HTMLLinkElement && existing.dataset.linnyaPluginCss === href) {
      existing.dataset.linnyaPluginId = pluginId;
      return;
    }
  }

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.linnyaPluginCss = href;
  link.dataset.linnyaPluginId = pluginId;
  document.head.appendChild(link);
}

function removeCssLinksForPlugin(pluginId: string): void {
  const existingLinks = Array.from(document.querySelectorAll('link[data-linnya-plugin-css]'));
  for (const existing of existingLinks) {
    if (existing instanceof HTMLLinkElement && existing.dataset.linnyaPluginId === pluginId) {
      existing.remove();
    }
  }
}

async function importRuntimeRendererPluginEntry(entryUrl: string): Promise<unknown> {
  return import(/* @vite-ignore */ entryUrl);
}

async function installRuntimeRendererPluginHostModules(): Promise<void> {
  const { installRendererPluginHostModules } = await import('./hostModuleProvider');
  installRendererPluginHostModules();
}

async function loadRendererPluginEntry(
  entry: RendererPluginEntry,
  importEntry: (entryUrl: string) => Promise<unknown>,
  diagnostics: RendererPluginLoadDiagnostics,
): Promise<RendererPluginContribution | null> {
  if (hasRendererPlugin(entry.pluginId)) {
    const contribution = getRendererPluginContribution(entry.pluginId);
    diagnostics.phase = 'reuse-existing';
    diagnostics.contribution = contribution ? describeRendererPluginContribution(contribution) : null;
    logRendererPluginLoadStep('reuse-existing', entry, {
      registryBefore: diagnostics.registryBefore,
      contribution: diagnostics.contribution,
    });
    return null;
  }

  diagnostics.phase = 'import-start';
  logRendererPluginLoadStep('import-start', entry, {
    registryBefore: diagnostics.registryBefore,
  });
  const moduleExports = await importEntry(entry.entryUrl);
  diagnostics.phase = 'import-success';
  diagnostics.moduleExports = describeRendererPluginModuleExports(moduleExports);
  logRendererPluginLoadStep('import-success', entry, {
    moduleExports: diagnostics.moduleExports,
  });

  diagnostics.phase = 'contribution-validate';
  const contribution = readRendererPluginContribution(moduleExports);
  if (!contribution) {
    throw new Error(`renderer 插件未导出 contribution: ${entry.pluginId}@${entry.version}`);
  }
  if (contribution.meta.id !== entry.pluginId) {
    throw new Error(
      `renderer 插件 contribution id 与入口不一致: entry=${entry.pluginId}, contribution=${contribution.meta.id}`,
    );
  }
  diagnostics.phase = 'contribution-validated';
  diagnostics.contribution = describeRendererPluginContribution(contribution);
  logRendererPluginLoadStep('contribution-validated', entry, {
    contribution: diagnostics.contribution,
  });

  diagnostics.phase = 'register-start';
  logRendererPluginLoadStep('register-start', entry, {
    registryBeforeRegister: describeRendererPluginRegistryForDiagnostics(),
  });
  registerRendererPlugin(contribution);
  diagnostics.phase = 'register-success';
  logRendererPluginLoadStep('register-success', entry, {
    registryAfterRegister: describeRendererPluginRegistryForDiagnostics(),
  });
  return contribution;
}

async function syncActiveRendererPluginEntries(
  entries: readonly RendererPluginEntry[],
  importEntry: (entryUrl: string) => Promise<unknown>,
): Promise<RendererPluginSyncDiagnostics> {
  const desiredPluginIds = new Set(entries.map((entry) => entry.pluginId));
  const deactivatedPluginIds: string[] = [];
  const failures: RendererPluginSyncFailureDiagnostics[] = [];
  for (const activePluginId of listActiveRendererPluginIds()) {
    if (!desiredPluginIds.has(activePluginId)) {
      console.info(`${rendererPluginLoaderLogPrefix} deactivate-stale-start`, {
        pluginId: activePluginId,
        registryBeforeDeactivate: describeRendererPluginRegistryForDiagnostics(),
      });
      await deactivateRendererPlugin(activePluginId);
      removeCssLinksForPlugin(activePluginId);
      deactivatedPluginIds.push(activePluginId);
      console.info(`${rendererPluginLoaderLogPrefix} deactivate-stale-success`, {
        pluginId: activePluginId,
        registryAfterDeactivate: describeRendererPluginRegistryForDiagnostics(),
      });
    }
  }

  for (const entry of entries) {
    let loadedContribution: RendererPluginContribution | null = null;
    const diagnostics: RendererPluginLoadDiagnostics = {
      phase: 'entry-start',
      entry: describeRendererPluginEntry(entry),
      registryBefore: describeRendererPluginRegistryForDiagnostics(),
      moduleExports: {
        exportType: 'not-imported',
        exportKeys: [],
        hasRendererPlugin: false,
        hasDefault: false,
        rendererPluginLooksLikeContribution: false,
        defaultLooksLikeContribution: false,
      },
      contribution: null,
    };
    try {
      diagnostics.phase = 'compatibility-admission';
      assertRendererUiCompatibility(entry);
      logRendererPluginLoadStep('compatibility-admission', entry, {
        hostRendererUiVersion: RENDERER_UI_VERSION,
      });
      loadedContribution = await loadRendererPluginEntry(entry, importEntry, diagnostics);
      const stylesheets = entry.cssUrls.length > 0
        ? entry.cssUrls
        : loadedContribution?.stylesheets ?? getRendererPluginContribution(entry.pluginId)?.stylesheets ?? [];
      diagnostics.phase = 'css-inject';
      logRendererPluginLoadStep('css-inject', entry, {
        stylesheets,
        stylesheetSource: entry.cssUrls.length > 0 ? 'runtime-entry' : 'contribution',
      });
      for (const cssUrl of stylesheets) {
        ensureCssLink(entry.pluginId, cssUrl);
      }
      diagnostics.phase = 'activate-start';
      logRendererPluginLoadStep('activate-start', entry, {
        registryBeforeActivate: describeRendererPluginRegistryForDiagnostics(),
      });
      await activateRendererPlugin(entry.pluginId);
      diagnostics.phase = 'activate-success';
      logRendererPluginLoadStep('activate-success', entry, {
        registryAfterActivate: describeRendererPluginRegistryForDiagnostics(),
      });
    } catch (error) {
      removeCssLinksForPlugin(entry.pluginId);
      if (loadedContribution) {
        unregisterRendererPluginContribution(entry.pluginId, loadedContribution);
      }
      const registryAfterCleanup = describeRendererPluginRegistryForDiagnostics();
      const failure: RendererPluginSyncFailureDiagnostics = {
        entry: diagnostics.entry,
        phase: diagnostics.phase,
        moduleExports: diagnostics.moduleExports,
        contribution: diagnostics.contribution,
        registryBefore: diagnostics.registryBefore,
        registryAfterCleanup,
        registeredBefore: hasPluginInRegistrySnapshot(diagnostics.registryBefore, entry.pluginId),
        activeBefore: hasActivePluginInRegistrySnapshot(diagnostics.registryBefore, entry.pluginId),
        registeredAfterCleanup: hasPluginInRegistrySnapshot(registryAfterCleanup, entry.pluginId),
        activeAfterCleanup: hasActivePluginInRegistrySnapshot(registryAfterCleanup, entry.pluginId),
        error: describeRendererPluginError(error),
      };
      failures.push(failure);
      console.error(`${rendererPluginLoaderLogPrefix} sync-failed-summary`, {
        pluginId: entry.pluginId,
        version: entry.version,
        phase: failure.phase,
        sourceKind: failure.entry.sourceKind,
        entryUrl: entry.entryUrl,
        pluginDir: failure.entry.pluginDir,
        entryPath: failure.entry.entryPath,
        error: summarizeRendererPluginError(failure.error),
        moduleExports: failure.moduleExports,
        registeredBefore: failure.registeredBefore,
        registeredAfterCleanup: failure.registeredAfterCleanup,
        activeAfterCleanup: failure.activeAfterCleanup,
      });
      console.error(`${rendererPluginLoaderLogPrefix} sync-failed`, failure);
    }
  }

  return {
    processedPluginIds: entries.map((entry) => entry.pluginId),
    deactivatedPluginIds,
    failures,
  };
}

async function syncRuntimeRendererPlugins(options: RuntimeRendererPluginLoaderOptions): Promise<void> {
  const runId = rendererPluginLoaderRunId + 1;
  rendererPluginLoaderRunId = runId;
  latestRendererPluginLoaderDiagnostics = {
    runId,
    status: 'running',
    startedAt: new Date().toISOString(),
    completedAt: null,
    hostModules: null,
    registryBeforeEntriesApi: null,
    entries: [],
    registryAfterSync: null,
    sync: null,
    error: null,
  };
  publishRendererPluginLoaderDiagnostics();
  const rendererEntriesApi = options.rendererEntriesApi ?? window.electronAPI?.plugins?.rendererEntries;
  if (!rendererEntriesApi) {
    const error = describeRendererPluginError(new Error(`${rendererPluginLoaderLogPrefix} renderer 插件入口 API 不可用`));
    latestRendererPluginLoaderDiagnostics = {
      ...latestRendererPluginLoaderDiagnostics,
      status: 'failed',
      completedAt: new Date().toISOString(),
      hostModules: describeRendererPluginHostModules(),
      registryBeforeEntriesApi: describeRendererPluginRegistryForDiagnostics(),
      error,
    };
    publishRendererPluginLoaderDiagnostics();
    console.error(`${rendererPluginLoaderLogPrefix} renderer-entries-api-missing`, {
      hostModules: describeRendererPluginHostModules(),
      registry: describeRendererPluginRegistryForDiagnostics(),
    });
    throw new Error(`${rendererPluginLoaderLogPrefix} renderer 插件入口 API 不可用`);
  }

  await (options.installHostModules ?? installRuntimeRendererPluginHostModules)();
  const hostModules = describeRendererPluginHostModules();
  console.info(`${rendererPluginLoaderLogPrefix} host-modules-installed`, hostModules);

  const registryBeforeEntriesApi = describeRendererPluginRegistryForDiagnostics();
  console.info(`${rendererPluginLoaderLogPrefix} renderer-entries-api-start`, {
    registryBeforeEntriesApi,
  });
  latestRendererPluginLoaderDiagnostics = {
    ...latestRendererPluginLoaderDiagnostics,
    hostModules,
    registryBeforeEntriesApi,
  };
  publishRendererPluginLoaderDiagnostics();
  const rawResult = await rendererEntriesApi();
  const result = parseRendererEntriesResult(rawResult);
  if (!result.success) {
    const error = describeRendererPluginError(new Error(result.error ?? 'renderer 插件入口读取失败'));
    latestRendererPluginLoaderDiagnostics = {
      ...latestRendererPluginLoaderDiagnostics,
      status: 'failed',
      completedAt: new Date().toISOString(),
      error,
    };
    publishRendererPluginLoaderDiagnostics();
    console.error(`${rendererPluginLoaderLogPrefix} renderer-entries-invalid`, {
      error: result.error,
      result: describeUnknownRendererEntriesResult(rawResult),
      hostModules: describeRendererPluginHostModules(),
      registry: describeRendererPluginRegistryForDiagnostics(),
    });
    throw new Error(result.error ?? 'renderer 插件入口读取失败');
  }

  const importEntry = options.importEntry ?? importRuntimeRendererPluginEntry;
  const entries = result.data.map(describeRendererPluginEntry);
  latestRendererPluginLoaderDiagnostics = {
    ...latestRendererPluginLoaderDiagnostics,
    entries,
  };
  publishRendererPluginLoaderDiagnostics();
  console.info(`${rendererPluginLoaderLogPrefix} renderer-entries-resolved`, {
    runId,
    entryCount: entries.length,
    entries: entries.map(summarizeRendererPluginEntry),
    hostModules: describeRendererPluginHostModules(),
    registryBeforeSync: summarizeRendererRegistry(describeRendererPluginRegistryForDiagnostics()),
  });
  const sync = await syncActiveRendererPluginEntries(result.data, importEntry);
  const registryAfterSync = describeRendererPluginRegistryForDiagnostics();
  latestRendererPluginLoaderDiagnostics = {
    ...latestRendererPluginLoaderDiagnostics,
    status: sync.failures.length > 0 ? 'failed' : 'success',
    completedAt: new Date().toISOString(),
    registryAfterSync,
    sync,
    error: sync.failures[0]?.error ?? null,
  };
  publishRendererPluginLoaderDiagnostics();
  console.info(`${rendererPluginLoaderLogPrefix} sync-complete`, {
    runId,
    activePluginIds: listActiveRendererPluginIds(),
    failureCount: sync.failures.length,
    failures: sync.failures.map((failure) => ({
      pluginId: failure.entry.pluginId,
      version: failure.entry.version,
      phase: failure.phase,
      sourceKind: failure.entry.sourceKind,
      entryUrl: failure.entry.entryUrl,
      error: summarizeRendererPluginError(failure.error),
    })),
    registryAfterSync: summarizeRendererRegistry(registryAfterSync),
  });
}

/**
 * Renderer 插件注册表是进程内单一可变资源，每次同步必须完整观察并提交一个入口快照。
 * 串行队列保留每次同步，确保“安装后立即卸载”等后续快照不会被 single-flight 合并丢失；
 * 前一次失败只反馈给对应调用方，不会阻断后续同步。
 */
export function loadRuntimeRendererPlugins(options: RuntimeRendererPluginLoaderOptions = {}): Promise<void> {
  const sync = rendererPluginSyncTail.then(() => syncRuntimeRendererPlugins(options));
  rendererPluginSyncTail = sync.catch(() => undefined);
  return sync;
}
