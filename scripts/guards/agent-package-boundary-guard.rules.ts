import path from 'node:path';

export type Violation = {
  ruleId: string;
  file: string;
  line: number;
  preview: string;
  importPath: string | null;
};

/**
 * 单个 import 站点的最小信息单元。由 TypeScript Compiler API 解析得来，
 * 因此天然不会把注释、字符串字面量、模板字符串、JSDoc 例子里出现的
 * "看起来像 import 的字符串"误认为真 import；同时区分静态 / 动态导入，
 * 让 AGENT-GUARD-01/02、03/04、05/06 这类成对规则得到精确判定。
 */
export type ExtractedImport = {
  importPath: string;
  /** 1-based line number */
  line: number;
  isStatic: boolean;
  /** 完整原始行内容，用作 violation.preview 显示给开发者 */
  preview: string;
};

export type AnalyzeImportOptions = {
  readonly includeRuntimePluginPackageRules?: boolean;
  /** @deprecated use includeRuntimePluginPackageRules */
  readonly includeMindmapPackageRules?: boolean;
};

type ImportRule = {
  ruleId: string;
  matches: (importPath: string, isStatic: boolean) => boolean;
};

export const repoRoot = process.cwd();
export const LINNKIT_SOURCE_PREFIX = 'packages/linnkit/src';
export const LINNKIT_PACKAGE_NAME = '@linnlabs/linnkit';
export const LEGACY_AGENT_SOURCE_PREFIX = 'src/agent';
export const MINDMAP_PACKAGE_PREFIX = 'packages/plugins/mindmap/src';
export const SLIDES_PACKAGE_PREFIX = 'packages/plugins/slides/src';
export const SHEET_PACKAGE_PREFIX = 'packages/plugins/sheet/src';
export const SUPPLYSTRATA_PACKAGE_PREFIX = 'packages/plugins/supplystrata/src';
export const PLUGIN_HOST_CONTRACT_PACKAGE_PREFIX = 'packages/plugin-host-contract';

type RuntimePluginPackageDefinition = {
  id: string;
  packagePrefix: string;
  extraPublicEntries?: readonly string[];
  backendOnlyPublicEntries?: readonly string[];
  rulePrefix: string;
};

const RUNTIME_PLUGIN_PACKAGES: readonly RuntimePluginPackageDefinition[] = [
  {
    id: 'mindmap',
    packagePrefix: MINDMAP_PACKAGE_PREFIX,
    rulePrefix: 'MINDMAP-PKG',
  },
  {
    id: 'slides',
    packagePrefix: SLIDES_PACKAGE_PREFIX,
    backendOnlyPublicEntries: ['backend-cli-contract', 'backend-codegen', 'backend-coordinator', 'backend-engine-core', 'backend-ipc', 'backend-sandbox', 'backend-tool-classes'],
    rulePrefix: 'SLIDES-PKG',
  },
  {
    id: 'sheet',
    packagePrefix: SHEET_PACKAGE_PREFIX,
    rulePrefix: 'SHEET-PKG',
  },
  {
    id: 'supplystrata',
    packagePrefix: SUPPLYSTRATA_PACKAGE_PREFIX,
    rulePrefix: 'SUPPLYSTRATA-PKG',
  },
] as const;

// 5BB：slidesLegacyBackend 过渡桥已整体删除；保留规则用于防止任何代码复活该桥（无任何豁免）。
const SLIDES_LEGACY_BACKEND_BRIDGE_IMPORT = '@plugin/backend/slidesLegacyBackend';
const SLIDES_LEGACY_BACKEND_BRIDGE_SOURCE = 'src/plugin-sdk/backend/slidesLegacyBackend';
const SLIDES_REMOVED_BACKEND_PERSISTENCE_ENTRY = '@plugin/slides/backend-persistence';

const SLIDES_LEGACY_HOST_RUNTIME_PREFIXES = [
  'src/features/ai-ppt',
  'src/tools/presentation',
  'apps/renderer/domains/slides',
] as const;
const SHEET_LEGACY_HOST_RUNTIME_PREFIXES = [
  'apps/renderer/domains/sheet',
] as const;
const SLIDES_LEGACY_HOST_RUNTIME_FILES = new Set([
  'src/features/sandbox/profiles/pptComposeProfile',
]);
const LEGACY_WORKSPACE_VFS_NODE_ACCESS_POLICY_SOURCE =
  'src/app-hosts/linnya/plugin-registry/workspaceVfsNodeAccessPolicy';
const PLUGIN_SDK_BACKEND_WORKSPACE_RUNTIME_SOURCE = 'src/plugin-sdk/backend/workspaceRuntime';
const PLUGIN_SDK_BACKEND_PLUGIN_CONTRIBUTION_SOURCE = 'src/plugin-sdk/backend/pluginContribution';
const HOST_PLUGIN_REGISTRY_TYPES_SOURCE = 'src/app-hosts/linnya/plugin-registry/types';
const PLUGIN_SDK_RENDERER_PLUGIN_CONTRIBUTION_SOURCE = 'src/plugin-sdk/renderer/pluginContribution';
const HOST_RENDERER_PLUGIN_TYPES_IMPORT = '@/app/plugins/types';
const PLUGIN_SDK_RENDERER_PORT_SOURCES = new Set([
  'src/plugin-sdk/renderer/composerCommandPort',
  'src/plugin-sdk/renderer/conversationSubrunInvocationPort',
  'src/plugin-sdk/renderer/interactiveTool',
  'src/plugin-sdk/renderer/referenceRuntime',
]);
const MINDMAP_RUNTIME_ACCESS_SYMBOLS = [
  'assertMindmapPluginRuntimeEnabled',
  'isMindmapPluginRuntimeEnabled',
] as const;

export const IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist_build',
  'build',
  'temp',
  'temp_ts_build',
  'temp_tsup',
]);

export const IGNORED_RELATIVE_PREFIXES: string[] = [];

export const FORBIDDEN_AGENT_DIRS = [
  'packages/linnkit',
  `${LEGACY_AGENT_SOURCE_PREFIX}/host-adapters`,
  `${LEGACY_AGENT_SOURCE_PREFIX}/product-extensions`,
  // Phase 5：Slides dev harness 和工具 facade 已迁出 host 旧入口，防止旧路径复活。
  'src/features/ai-ppt/tools',
  'src/tools/presentation',
  'apps/renderer/domains/slides',
  'apps/renderer/domains/sheet',
  'src/features/sandbox/profiles/pptComposeProfile.ts',
  'src/features/sandbox/profiles/pptComposeProfile.ambient.d.ts',
];

const PUBLIC_AGENT_ENTRY_NAMES = new Set([
  'ports',
  'contracts',
  'runtime-kernel',
  'context-manager',
  'testkit',
]);

/**
 * 允许的二级公开子入口（"browser-safe slim seam"白名单）。
 *
 * 用途：默认 deep import 规则只放行 `linnkit/<single-segment>`；但少数二级子入口
 * 是有意为浏览器侧 transitive 安全暴露的瘦门面（如 `runtime-kernel/events` 仅
 * 暴露 events governance 纯函数，不会拖入 Node-only 依赖）。这些必须在此显式
 * 列出，禁止隐式扩张。
 *
 * 加新条目前必须同时满足：
 * 1. 该子入口在独立 Linnkit package 的 `exports` 字段里有显式声明
 * 2. Linnya 只能通过 npm package export 消费
 * 3. 该子入口 transitive 不会拖入 Node-only API（`crypto` / `node:async_hooks` 等）
 */
const PUBLIC_AGENT_NESTED_ENTRY_PATHS = new Set([
  'runtime-kernel/events',
]);

const INTERNAL_ONLY_IMPORT_PATHS = new Set([
  `${LINNKIT_SOURCE_PREFIX}/shared/TokenCalculator`,
  `${LINNKIT_SOURCE_PREFIX}/shared/errorClassifier`,
  `${LINNKIT_SOURCE_PREFIX}/shared/logger`,
  `${LEGACY_AGENT_SOURCE_PREFIX}/shared/TokenCalculator`,
  `${LEGACY_AGENT_SOURCE_PREFIX}/shared/errorClassifier`,
  `${LEGACY_AGENT_SOURCE_PREFIX}/shared/logger`,
]);

export const BASELINE_ELIGIBLE_RULE_IDS = new Set([
  'AGENT-GUARD-07-no-host-deep-import',
  'AGENT-GUARD-08-no-cross-submodule-deep-import',
  'AGENT-GUARD-09-no-internal-only-import',
  'MINDMAP-PKG-01-no-host-internal-import',
  'MINDMAP-PKG-02-no-mindmap-package-deep-import',
  'SLIDES-PKG-01-no-host-internal-import',
  'SLIDES-PKG-02-no-slides-package-deep-import',
  'SHEET-PKG-01-no-host-internal-import',
  'SHEET-PKG-02-no-sheet-package-deep-import',
  'SUPPLYSTRATA-PKG-01-no-host-internal-import',
  'SUPPLYSTRATA-PKG-02-no-supplystrata-package-deep-import',
]);
export const ENFORCE_EMPTY_DEEP_IMPORT_BASELINE = true;

const FORBIDDEN_IMPORT_RULES: ImportRule[] = [
  {
    ruleId: 'AGENT-GUARD-01-no-app-host-imports',
    matches: (p, isStatic) => isStatic && isAppHostsImport(p),
  },
  {
    ruleId: 'AGENT-GUARD-02-no-dynamic-app-host-imports',
    matches: (p, isStatic) => !isStatic && isAppHostsImport(p),
  },
  {
    ruleId: 'AGENT-GUARD-03-no-external-src-imports',
    matches: (p, isStatic) => isStatic && isExternalSrcImport(p),
  },
  {
    ruleId: 'AGENT-GUARD-04-no-dynamic-external-src-imports',
    matches: (p, isStatic) => !isStatic && isExternalSrcImport(p),
  },
  {
    ruleId: 'AGENT-GUARD-05-no-non-schema-app-imports',
    matches: (p, isStatic) => isStatic && isNonSchemaAppImport(p),
  },
  {
    ruleId: 'AGENT-GUARD-06-no-dynamic-non-schema-app-imports',
    matches: (p, isStatic) => !isStatic && isNonSchemaAppImport(p),
  },
];

function isAppHostsImport(importPath: string): boolean {
  return importPath.startsWith('src/app-hosts/');
}

function isExternalSrcImport(importPath: string): boolean {
  return importPath.startsWith('src/') && !importPath.startsWith('src/agent/');
}

function isNonSchemaAppImport(importPath: string): boolean {
  return importPath.startsWith('@app/')
    && importPath !== '@app/schemas'
    && !importPath.startsWith('@app/schemas/');
}

export function rel(filePath: string): string {
  return path.relative(repoRoot, filePath).replaceAll('\\', '/');
}

export function normalizeFilePath(filePath: string): string {
  return filePath.replaceAll('\\', '/');
}

function stripKnownExtension(importPath: string): string {
  return importPath.replace(/\.(?:ts|tsx|js|mjs|cjs)$/, '');
}

export function isSourceFile(filePath: string): boolean {
  const ext = path.extname(filePath);
  return ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.vue'].includes(ext);
}

function isTestFile(filePath: string): boolean {
  if (
    filePath.includes('/__tests__/')
    || filePath.includes('/__test__/')
    || filePath.includes('/__test-helpers__/')
    || filePath.includes('/__benchmarks__/')
    || filePath.includes('/__bench__/')
  ) {
    return true;
  }

  return /\.(?:test|spec|bench)\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(filePath);
}

/**
 * 测试基础设施配置/setup 文件：vitest.config.*、vitest.<profile>.config.*、vitest.setup.* / jest.setup.*。
 * 这些文件允许 import 'vitest'，但不进 production bundle。
 */
function isTestInfrastructureFile(filePath: string): boolean {
  const base = path.basename(filePath);
  return /^(?:vitest(?:\.[^.]+)*\.config|vitest\.setup|jest\.setup)\.(?:ts|js|mjs|cjs)$/.test(base);
}

function isPluginDevelopmentSource(filePath: string): boolean {
  return /^packages\/plugins\/[^/]+\/dev\//.test(filePath);
}

export function isProductionSource(filePath: string): boolean {
  return (
    isSourceFile(filePath)
    && !isTestFile(filePath)
    && !isTestInfrastructureFile(filePath)
    && !isPluginDevelopmentSource(filePath)
  );
}

/**
 * 路径段中含 `testkit` 视为 testkit 源（不是 production runtime）。
 * 例：`src/app-hosts/linnya/testkit/agent-harness/childRunHarness.ts`。
 * 这些文件允许 import `vitest` / `linnkit/testkit`，但禁止被 production runtime
 * 通过 import 拖入 backend bundle（由 AGENT-GUARD-10 守护）。
 */
function isTestkitSource(filePath: string): boolean {
  return filePath.split('/').includes('testkit');
}

export function isIgnoredGuardPath(filePath: string): boolean {
  return IGNORED_RELATIVE_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

function isAgentFile(filePath: string): boolean {
  return (
    filePath === LINNKIT_SOURCE_PREFIX
    || filePath.startsWith(`${LINNKIT_SOURCE_PREFIX}/`)
    || filePath === LEGACY_AGENT_SOURCE_PREFIX
    || filePath.startsWith(`${LEGACY_AGENT_SOURCE_PREFIX}/`)
  );
}

function isRuntimePluginPackageFile(
  filePath: string,
  pluginPackage: RuntimePluginPackageDefinition,
): boolean {
  return (
    filePath === pluginPackage.packagePrefix
    || filePath.startsWith(`${pluginPackage.packagePrefix}/`)
  );
}

function isPluginCompositionTestFile(filePath: string): boolean {
  return filePath.startsWith('packages/plugins/__tests__/');
}

function isRendererRuntimePluginPackageFile(
  filePath: string,
  pluginPackage: RuntimePluginPackageDefinition,
): boolean {
  return (
    filePath === `${pluginPackage.packagePrefix}/renderer`
    || filePath.startsWith(`${pluginPackage.packagePrefix}/renderer/`)
  );
}

function isRendererHostFile(filePath: string): boolean {
  return filePath === 'apps/renderer' || filePath.startsWith('apps/renderer/');
}

function isRendererSideFile(
  filePath: string,
  pluginPackage: RuntimePluginPackageDefinition,
): boolean {
  return isRendererHostFile(filePath) || isRendererRuntimePluginPackageFile(filePath, pluginPackage);
}

function createViolation(
  ruleId: string,
  file: string,
  line: number,
  preview: string,
  importPath: string | null,
): Violation {
  return {
    ruleId,
    file,
    line,
    preview,
    importPath,
  };
}

function isAllowedHostAgentImport(importPath: string): boolean {
  if (
    importPath === LINNKIT_PACKAGE_NAME
    || importPath === 'linnkit'
    || importPath === LEGACY_AGENT_SOURCE_PREFIX
  ) {
    return true;
  }

  const publicSubpath = readLinnkitPackageSubpath(importPath)
    ?? (importPath.startsWith(`${LEGACY_AGENT_SOURCE_PREFIX}/`)
      ? importPath.slice(`${LEGACY_AGENT_SOURCE_PREFIX}/`.length)
      : null);
  if (publicSubpath && !publicSubpath.includes('/') && PUBLIC_AGENT_ENTRY_NAMES.has(publicSubpath)) {
    return true;
  }

  if (publicSubpath && PUBLIC_AGENT_NESTED_ENTRY_PATHS.has(publicSubpath)) {
    return true;
  }

  return false;
}

function topLevelAgentSubmodule(filePath: string): string | null {
  const linnkitMatch = filePath.match(/^packages\/linnkit\/src\/([^/]+)/);
  if (linnkitMatch?.[1]) {
    return linnkitMatch[1];
  }

  const legacyMatch = filePath.match(/^src\/agent\/([^/]+)/);
  return legacyMatch?.[1] ?? null;
}

function isAgentPackageImportPath(importPath: string): boolean {
  return (
    importPath === LINNKIT_PACKAGE_NAME
    || importPath.startsWith(`${LINNKIT_PACKAGE_NAME}/`)
    || importPath === 'linnkit'
    || importPath.startsWith('linnkit/')
    || importPath === LEGACY_AGENT_SOURCE_PREFIX
    || importPath.startsWith(`${LEGACY_AGENT_SOURCE_PREFIX}/`)
    || importPath === LINNKIT_SOURCE_PREFIX
    || importPath.startsWith(`${LINNKIT_SOURCE_PREFIX}/`)
  );
}

function normalizeBareLinnkitImport(importPath: string): string {
  if (importPath === LINNKIT_PACKAGE_NAME || importPath === 'linnkit') {
    return `${LINNKIT_SOURCE_PREFIX}/index`;
  }

  const suffix = readLinnkitPackageSubpath(importPath);
  if (suffix === null) {
    return importPath;
  }

  return `${LINNKIT_SOURCE_PREFIX}/${suffix}`;
}

function readLinnkitPackageSubpath(importPath: string): string | null {
  for (const packageName of [LINNKIT_PACKAGE_NAME, 'linnkit']) {
    const prefix = `${packageName}/`;
    if (importPath.startsWith(prefix)) {
      return importPath.slice(prefix.length);
    }
  }

  return null;
}

function normalizeBareRuntimePluginPackageImport(importPath: string): string {
  for (const pluginPackage of RUNTIME_PLUGIN_PACKAGES) {
    if (importPath === `@plugin/${pluginPackage.id}/shared`) {
      return `${pluginPackage.packagePrefix}/shared/index`;
    }
    if (importPath === `@plugin/${pluginPackage.id}/backend`) {
      return `${pluginPackage.packagePrefix}/backend/index`;
    }
    if (importPath === `@plugin/${pluginPackage.id}/renderer`) {
      return `${pluginPackage.packagePrefix}/renderer/index`;
    }

    const pluginImportPrefix = `@plugin/${pluginPackage.id}/`;
    if (importPath.startsWith(pluginImportPrefix)) {
      return `${pluginPackage.packagePrefix}/${importPath.slice(pluginImportPrefix.length)}`;
    }
  }

  return importPath;
}

function normalizeResolvedImportPath(filePath: string, importPath: string): string | null {
  const normalizedImportPath = stripKnownExtension(normalizeBareRuntimePluginPackageImport(
    normalizeBareLinnkitImport(normalizeFilePath(importPath)),
  ));
  if (
    normalizedImportPath.startsWith(LINNKIT_SOURCE_PREFIX)
    || normalizedImportPath.startsWith(LEGACY_AGENT_SOURCE_PREFIX)
    || RUNTIME_PLUGIN_PACKAGES.some(pluginPackage =>
      normalizedImportPath.startsWith(pluginPackage.packagePrefix)
    )
  ) {
    return normalizedImportPath;
  }

  if (!normalizedImportPath.startsWith('.')) {
    return null;
  }

  const resolvedPath = path.resolve(repoRoot, path.dirname(filePath), normalizedImportPath);
  return stripKnownExtension(rel(resolvedPath));
}

function normalizeSlidesLegacyHostRuntimeImportPath(filePath: string, importPath: string): string | null {
  const normalizedImportPath = stripKnownExtension(normalizeFilePath(importPath));
  if (normalizedImportPath === '@/domains/slides') {
    return 'apps/renderer/domains/slides';
  }
  if (normalizedImportPath.startsWith('@/domains/slides/')) {
    return `apps/renderer/domains/slides/${normalizedImportPath.slice('@/domains/slides/'.length)}`;
  }
  if (normalizedImportPath === '@tools/presentation') {
    return 'src/tools/presentation';
  }
  if (normalizedImportPath.startsWith('@tools/presentation/')) {
    return `src/tools/presentation/${normalizedImportPath.slice('@tools/presentation/'.length)}`;
  }

  if (normalizedImportPath.startsWith('src/')) {
    return normalizedImportPath;
  }

  return normalizeResolvedImportPath(filePath, importPath);
}

function normalizeSheetLegacyHostRuntimeImportPath(filePath: string, importPath: string): string | null {
  const normalizedImportPath = stripKnownExtension(normalizeFilePath(importPath));
  if (normalizedImportPath === '@/domains/sheet') {
    return 'apps/renderer/domains/sheet';
  }
  if (normalizedImportPath.startsWith('@/domains/sheet/')) {
    return `apps/renderer/domains/sheet/${normalizedImportPath.slice('@/domains/sheet/'.length)}`;
  }

  if (normalizedImportPath.startsWith('src/') || normalizedImportPath.startsWith('apps/')) {
    return normalizedImportPath;
  }

  return normalizeResolvedImportPath(filePath, importPath);
}

function isSlidesLegacyHostRuntimePath(filePath: string): boolean {
  return (
    SLIDES_LEGACY_HOST_RUNTIME_PREFIXES.some(prefix =>
      filePath === prefix || filePath.startsWith(`${prefix}/`)
    )
    || SLIDES_LEGACY_HOST_RUNTIME_FILES.has(filePath)
  );
}

function isSheetLegacyHostRuntimePath(filePath: string): boolean {
  return SHEET_LEGACY_HOST_RUNTIME_PREFIXES.some(prefix =>
    filePath === prefix || filePath.startsWith(`${prefix}/`)
  );
}

function isSlidesLegacyHostRuntimeIslandFile(filePath: string): boolean {
  return SLIDES_LEGACY_HOST_RUNTIME_PREFIXES.some(prefix =>
    filePath === prefix || filePath.startsWith(`${prefix}/`)
  );
}

function isSheetLegacyHostRuntimeIslandFile(filePath: string): boolean {
  return SHEET_LEGACY_HOST_RUNTIME_PREFIXES.some(prefix =>
    filePath === prefix || filePath.startsWith(`${prefix}/`)
  );
}

function isSubmodulePublicEntryImport(importPath: string): boolean {
  return (
    /^packages\/linnkit\/src\/[^/]+$/.test(importPath)
    || /^packages\/linnkit\/src\/[^/]+\/index$/.test(importPath)
    || /^src\/agent\/[^/]+$/.test(importPath)
    || /^src\/agent\/[^/]+\/index$/.test(importPath)
  );
}

function isPublicRuntimePluginPackageEntry(
  importPath: string,
  pluginPackage: RuntimePluginPackageDefinition,
): boolean {
  const publicEntryPrefix = `@plugin/${pluginPackage.id}/`;
  return (
    importPath === `@plugin/${pluginPackage.id}/shared`
    || importPath === `@plugin/${pluginPackage.id}/backend`
    || importPath === `@plugin/${pluginPackage.id}/renderer`
    || pluginPackage.extraPublicEntries?.some(entry =>
      importPath === `${publicEntryPrefix}${entry}`
    ) === true
    || pluginPackage.backendOnlyPublicEntries?.some(entry =>
      importPath === `${publicEntryPrefix}${entry}`
    ) === true
  );
}

function isBackendOnlyRuntimePluginPackageEntry(
  importPath: string,
  pluginPackage: RuntimePluginPackageDefinition,
): boolean {
  const publicEntryPrefix = `@plugin/${pluginPackage.id}/`;
  return (
    importPath === `@plugin/${pluginPackage.id}/backend`
    || pluginPackage.backendOnlyPublicEntries?.some(entry =>
      importPath === `${publicEntryPrefix}${entry}`
    ) === true
  );
}

function isAllowedRuntimePluginSdkImport(
  importPath: string,
  pluginPackage: RuntimePluginPackageDefinition,
): boolean {
  return (
    importPath === '@app/localization'
    || importPath.startsWith('@plugin/backend/')
    || importPath.startsWith('@plugin/renderer/')
    || isPublicRuntimePluginPackageEntry(importPath, pluginPackage)
  );
}

function isForbiddenRuntimePluginPackageBareImport(
  importPath: string,
  pluginPackage: RuntimePluginPackageDefinition,
): boolean {
  if (importPath === '@app/schemas' || importPath.startsWith('@app/schemas/')) {
    return false;
  }

  if (
    importPath === 'linnkit'
    || importPath.startsWith('linnkit/')
    || importPath === '@linnlabs/linnkit'
    || importPath.startsWith('@linnlabs/linnkit/')
  ) {
    return false;
  }

  // 中文说明：只允许宿主 SDK 入口和当前插件自己的公开入口。
  // 其它 `@plugin/<id>` 很可能是跨插件私有耦合，必须先沉到平台 SDK。
  if (isAllowedRuntimePluginSdkImport(importPath, pluginPackage)) {
    return false;
  }

  return (
    importPath.startsWith('src/')
    || importPath.startsWith('apps/')
    || importPath === '@'
    || importPath.startsWith('@/')
    || importPath === '@app'
    || importPath.startsWith('@app/')
    || importPath === '@shared'
    || importPath.startsWith('@shared/')
    || importPath === '@features'
    || importPath.startsWith('@features/')
    || importPath === '@tools'
    || importPath.startsWith('@tools/')
    || importPath === '@core'
    || importPath.startsWith('@core/')
    || importPath === '@infra'
    || importPath.startsWith('@infra/')
    || importPath.startsWith('@plugin/')
  );
}

function analyzeRuntimePluginPackageHostImportRule(
  pluginPackage: RuntimePluginPackageDefinition,
  file: string,
  line: number,
  preview: string,
  importPath: string,
): Violation[] {
  if (!isRuntimePluginPackageFile(file, pluginPackage)) {
    return [];
  }

  const resolvedImportPath = normalizeResolvedImportPath(file, importPath);
  if (resolvedImportPath !== null) {
    if (isPluginPackageManifestImport(resolvedImportPath, pluginPackage)) {
      return [];
    }

    if (resolvedImportPath.startsWith(pluginPackage.packagePrefix)) {
      return [];
    }

    return [
      createViolation(`${pluginPackage.rulePrefix}-01-no-host-internal-import`, file, line, preview, importPath),
    ];
  }

  if (!isForbiddenRuntimePluginPackageBareImport(importPath, pluginPackage)) {
    return [];
  }

  return [
    createViolation(`${pluginPackage.rulePrefix}-01-no-host-internal-import`, file, line, preview, importPath),
  ];
}

function isPluginPackageManifestImport(
  resolvedImportPath: string,
  pluginPackage: RuntimePluginPackageDefinition,
): boolean {
  return resolvedImportPath === `packages/plugins/${pluginPackage.id}/plugin.json`;
}

function analyzeRuntimePluginPackageDeepImportRule(
  pluginPackage: RuntimePluginPackageDefinition,
  file: string,
  line: number,
  preview: string,
  importPath: string,
): Violation[] {
  if (
    isBackendOnlyRuntimePluginPackageEntry(importPath, pluginPackage)
    && isRendererSideFile(file, pluginPackage)
  ) {
    return [
      createViolation(`${pluginPackage.rulePrefix}-04-backend-entry-not-from-renderer`, file, line, preview, importPath),
    ];
  }

  if (isRuntimePluginPackageFile(file, pluginPackage)) {
    return [];
  }

  if (importPath === `@plugin/${pluginPackage.id}/backend`) {
    // 中文说明：跨插件组合验收属于 workspace composition，不是 Core 运行时。
    // 这是唯一允许静态组装多个插件 backend contribution 的仓内位置。
    if (isPluginCompositionTestFile(file)) return [];
    return [
      createViolation(`${pluginPackage.rulePrefix}-03-backend-entry-not-from-host`, file, line, preview, importPath),
    ];
  }

  if (isPublicRuntimePluginPackageEntry(importPath, pluginPackage)) {
    return [];
  }

  const resolvedImportPath = normalizeResolvedImportPath(file, importPath);
  const isDeepImport = resolvedImportPath?.startsWith(pluginPackage.packagePrefix) === true
    || importPath.startsWith(`${pluginPackage.packagePrefix}/`)
    || importPath.startsWith(`@plugin/${pluginPackage.id}/`);
  if (!isDeepImport) {
    return [];
  }

  return [
    createViolation(
      `${pluginPackage.rulePrefix}-02-no-${pluginPackage.id}-package-deep-import`,
      file,
      line,
      preview,
      importPath,
    ),
  ];
}

function analyzeConcreteRendererPluginImportRule(
  pluginPackage: RuntimePluginPackageDefinition,
  file: string,
  line: number,
  preview: string,
  importPath: string,
): Violation[] {
  if (isRuntimePluginPackageFile(file, pluginPackage)) {
    return [];
  }

  if (importPath !== `@plugin/${pluginPackage.id}/renderer`) {
    return [];
  }

  return [
    createViolation(`${pluginPackage.rulePrefix}-08-no-host-renderer-plugin-entry-import`, file, line, preview, importPath),
  ];
}

function analyzeRuntimePluginRendererBackendImportRule(
  pluginPackage: RuntimePluginPackageDefinition,
  file: string,
  line: number,
  preview: string,
  importPath: string,
): Violation[] {
  if (!isRendererRuntimePluginPackageFile(file, pluginPackage)) {
    return [];
  }

  const resolvedImportPath = normalizeResolvedImportPath(file, importPath);
  const importsBackend = resolvedImportPath?.startsWith(`${pluginPackage.packagePrefix}/backend`) === true
    || importPath === `@plugin/${pluginPackage.id}/backend`
    || importPath.startsWith(`@plugin/${pluginPackage.id}/backend/`);
  if (!importsBackend) {
    return [];
  }

  return [
    createViolation(`${pluginPackage.rulePrefix}-09-no-renderer-backend-import`, file, line, preview, importPath),
  ];
}

function analyzeRuntimePluginPackageRules(
  file: string,
  line: number,
  preview: string,
  importPath: string,
): Violation[] {
  return RUNTIME_PLUGIN_PACKAGES.flatMap(pluginPackage => [
    ...analyzeSlidesRemovedBackendPersistenceEntryRule(pluginPackage, file, line, preview, importPath),
    ...analyzeRuntimePluginPackageHostImportRule(pluginPackage, file, line, preview, importPath),
    ...analyzeRuntimePluginPackageDeepImportRule(pluginPackage, file, line, preview, importPath),
    ...analyzeConcreteRendererPluginImportRule(pluginPackage, file, line, preview, importPath),
    ...analyzeRuntimePluginRendererBackendImportRule(pluginPackage, file, line, preview, importPath),
    ...analyzeSlidesLegacyBackendBridgeRule(pluginPackage, file, line, preview, importPath),
    ...analyzeSlidesLegacyHostRuntimeImportRule(pluginPackage, file, line, preview, importPath),
    ...analyzeSheetLegacyHostRuntimeImportRule(pluginPackage, file, line, preview, importPath),
  ]);
}

function analyzeSlidesLegacyBackendBridgeRule(
  pluginPackage: RuntimePluginPackageDefinition,
  file: string,
  line: number,
  preview: string,
  importPath: string,
): Violation[] {
  if (pluginPackage.id !== 'slides') {
    return [];
  }

  const resolvedImportPath = normalizeResolvedImportPath(file, importPath);
  const isLegacyBridgeImport = importPath === SLIDES_LEGACY_BACKEND_BRIDGE_IMPORT
    || resolvedImportPath === SLIDES_LEGACY_BACKEND_BRIDGE_SOURCE
    || stripKnownExtension(importPath) === SLIDES_LEGACY_BACKEND_BRIDGE_SOURCE;
  if (!isLegacyBridgeImport) {
    return [];
  }

  return [
    createViolation('SLIDES-PKG-05-legacy-backend-bridge-restricted', file, line, preview, importPath),
  ];
}

function analyzeSlidesRemovedBackendPersistenceEntryRule(
  pluginPackage: RuntimePluginPackageDefinition,
  file: string,
  line: number,
  preview: string,
  importPath: string,
): Violation[] {
  if (pluginPackage.id !== 'slides' || importPath !== SLIDES_REMOVED_BACKEND_PERSISTENCE_ENTRY) {
    return [];
  }

  return [
    createViolation('SLIDES-PKG-07-no-backend-persistence-public-entry', file, line, preview, importPath),
  ];
}

function analyzeSlidesLegacyHostRuntimeImportRule(
  pluginPackage: RuntimePluginPackageDefinition,
  file: string,
  line: number,
  preview: string,
  importPath: string,
): Violation[] {
  if (pluginPackage.id !== 'slides' || isSlidesLegacyHostRuntimeIslandFile(file)) {
    return [];
  }

  const resolvedImportPath = normalizeSlidesLegacyHostRuntimeImportPath(file, importPath);
  if (resolvedImportPath === null || !isSlidesLegacyHostRuntimePath(resolvedImportPath)) {
    return [];
  }

  return [
    createViolation('SLIDES-PKG-06-no-host-legacy-runtime-import', file, line, preview, importPath),
  ];
}

function analyzeSheetLegacyHostRuntimeImportRule(
  pluginPackage: RuntimePluginPackageDefinition,
  file: string,
  line: number,
  preview: string,
  importPath: string,
): Violation[] {
  if (pluginPackage.id !== 'sheet' || isSheetLegacyHostRuntimeIslandFile(file)) {
    return [];
  }

  const resolvedImportPath = normalizeSheetLegacyHostRuntimeImportPath(file, importPath);
  if (resolvedImportPath === null || !isSheetLegacyHostRuntimePath(resolvedImportPath)) {
    return [];
  }

  return [
    createViolation('SHEET-PKG-10-no-host-legacy-renderer-runtime-import', file, line, preview, importPath),
  ];
}

function analyzeLegacyRules(
  file: string,
  line: number,
  preview: string,
  importPath: string,
  isStatic: boolean,
): Violation[] {
  if (!isAgentFile(file)) {
    return [];
  }

  const violations: Violation[] = [];
  for (const rule of FORBIDDEN_IMPORT_RULES) {
    if (rule.matches(importPath, isStatic)) {
      violations.push(createViolation(rule.ruleId, file, line, preview, importPath));
    }
  }

  return violations;
}

function analyzeHostDeepImportRule(
  file: string,
  line: number,
  preview: string,
  importPath: string,
): Violation[] {
  if (isAgentFile(file) || !isAgentPackageImportPath(importPath)) {
    return [];
  }

  if (isAllowedHostAgentImport(importPath)) {
    return [];
  }

  return [
    createViolation('AGENT-GUARD-07-no-host-deep-import', file, line, preview, importPath),
  ];
}

function analyzeCrossSubmoduleRule(
  file: string,
  line: number,
  preview: string,
  importPath: string,
): Violation[] {
  if (!isAgentFile(file)) {
    return [];
  }

  const fromSubmodule = topLevelAgentSubmodule(file);
  if (fromSubmodule === null || fromSubmodule === 'shared') {
    return [];
  }

  const resolvedImportPath = normalizeResolvedImportPath(file, importPath);
  if (resolvedImportPath === null || !isAgentFile(resolvedImportPath)) {
    return [];
  }

  const toSubmodule = topLevelAgentSubmodule(resolvedImportPath);
  if (toSubmodule === null || toSubmodule === fromSubmodule || toSubmodule === 'shared') {
    return [];
  }

  if (isSubmodulePublicEntryImport(resolvedImportPath)) {
    return [];
  }

  return [
    createViolation(
      'AGENT-GUARD-08-no-cross-submodule-deep-import',
      file,
      line,
      preview,
      importPath,
    ),
  ];
}

function analyzeInternalOnlyImportRule(
  file: string,
  line: number,
  preview: string,
  importPath: string,
): Violation[] {
  if (isAgentFile(file) || !INTERNAL_ONLY_IMPORT_PATHS.has(importPath)) {
    return [];
  }

  return [
    createViolation('AGENT-GUARD-09-no-internal-only-import', file, line, preview, importPath),
  ];
}

/**
 * AGENT-GUARD-10：production runtime 禁止 import 测试基础设施。
 *
 * 背景：Linnkit 的 `testkit` 子入口会使用 Vitest。tsup/esbuild 处理 `export *` 是静态拉链，
 * 任何 production runtime 文件 `import '@linnlabs/linnkit/testkit'` 都会把 vitest 拖进
 * backend bundle，导致 electron main 启动时抛 "Vitest failed to access its
 * internal state."。同理直接 `import 'vitest'` 也会污染 bundle。
 *
 * 例外：路径段中含 `testkit` 的源文件本身就是测试基础设施，允许 import vitest
 * 或 linnkit/testkit。通过 `isTestkitSource()` 路径段识别。
 */
function analyzeTestkitInProductionRule(
  file: string,
  line: number,
  preview: string,
  importPath: string,
): Violation[] {
  if (isTestkitSource(file)) {
    return [];
  }

  const isVitest = importPath === 'vitest' || importPath.startsWith('vitest/');
  const isLinnkitTestkit = importPath === `${LINNKIT_PACKAGE_NAME}/testkit`
    || importPath.startsWith(`${LINNKIT_PACKAGE_NAME}/testkit/`)
    || importPath === 'linnkit/testkit'
    || importPath.startsWith('linnkit/testkit/');
  const isPluginHostTestRuntime = importPath === '@plugin/backend/testRuntime';
  if (!isVitest && !isLinnkitTestkit && !isPluginHostTestRuntime) {
    return [];
  }

  return [
    createViolation('AGENT-GUARD-10-no-testkit-in-production', file, line, preview, importPath),
  ];
}

function analyzeContextSharedProfileImportRule(
  file: string,
  line: number,
  preview: string,
  importPath: string,
): Violation[] {
  if (!file.startsWith(`${LINNKIT_SOURCE_PREFIX}/context-manager/shared/`)) {
    return [];
  }

  const resolvedImportPath = normalizeResolvedImportPath(file, importPath);
  if (resolvedImportPath === null) {
    return [];
  }

  if (!resolvedImportPath.startsWith(`${LINNKIT_SOURCE_PREFIX}/context-manager/profiles/`)) {
    return [];
  }

  return [
    createViolation('AGENT-GUARD-11-no-context-shared-profile-import', file, line, preview, importPath),
  ];
}

/**
 * AGENT-GUARD-12：Linnya 只能通过正式 npm 包名消费 Linnkit。
 *
 * `linnkit/*` 曾依赖 tsconfig / Vite alias 直连 monorepo 源码，会让本地开发与
 * npm 安装产物走两套模块解析。迁移到独立发布包后，任何旧 bare import 回流都
 * 必须立即失败。
 */
function analyzeLegacyLinnkitPackageImportRule(
  file: string,
  line: number,
  preview: string,
  importPath: string,
): Violation[] {
  if (importPath !== 'linnkit' && !importPath.startsWith('linnkit/')) {
    return [];
  }

  return [
    createViolation('AGENT-GUARD-12-no-legacy-linnkit-import', file, line, preview, importPath),
  ];
}

/**
 * 单个 import 站点的规则评估。所有真规则在这里集中：legacy forbidden 规则、
 * GUARD-07/08/09/10/11/12。无论调用方来自 AST 扫描（生产路径）还是 `analyzeLine()`
 * 兼容包装（单元测试路径），逻辑共用。
 */
export function analyzeImport(
  file: string,
  line: number,
  importPath: string,
  isStatic: boolean,
  preview: string,
  options: AnalyzeImportOptions = {},
): Violation[] {
  return [
    ...analyzeLegacyRules(file, line, preview, importPath, isStatic),
    ...analyzeHostDeepImportRule(file, line, preview, importPath),
    ...analyzeCrossSubmoduleRule(file, line, preview, importPath),
    ...analyzeInternalOnlyImportRule(file, line, preview, importPath),
    ...analyzeTestkitInProductionRule(file, line, preview, importPath),
    ...analyzeContextSharedProfileImportRule(file, line, preview, importPath),
    ...analyzeLegacyLinnkitPackageImportRule(file, line, preview, importPath),
    ...analyzePluginHostContractImportRule(file, line, preview, importPath),
    ...analyzeLegacyWorkspaceVfsPolicyImportRule(file, line, preview, importPath),
    ...analyzePluginWorkspaceRuntimeMindmapAccessRule(file, line, preview, importPath),
    ...analyzeSdkPluginContributionHostRegistryTypesRule(file, line, preview, importPath),
    ...analyzeRendererSdkPluginContributionHostTypesRule(file, line, preview, importPath),
    ...analyzeRendererSdkPortHostDomainImportRule(file, line, preview, importPath),
    ...(options.includeRuntimePluginPackageRules || options.includeMindmapPackageRules
      ? analyzeRuntimePluginPackageRules(file, line, preview, importPath)
      : []),
  ];
}

function analyzePluginHostContractImportRule(
  file: string,
  line: number,
  preview: string,
  importPath: string,
): Violation[] {
  if (
    file !== PLUGIN_HOST_CONTRACT_PACKAGE_PREFIX
    && !file.startsWith(`${PLUGIN_HOST_CONTRACT_PACKAGE_PREFIX}/`)
  ) {
    return [];
  }

  if (isAllowedPluginHostContractImport(importPath)) {
    return [];
  }

  return [
    createViolation('PLUGIN-CONTRACT-01-no-host-internal-import', file, line, preview, importPath),
  ];
}

function isAllowedPluginHostContractImport(importPath: string): boolean {
  if (importPath.startsWith('.')) {
    return true;
  }

  if (importPath === 'vue') {
    return true;
  }

  if (importPath === '@app/schemas' || importPath.startsWith('@app/schemas/')) {
    return true;
  }

  if (
    importPath === 'linnkit'
    || importPath.startsWith('linnkit/')
    || importPath === '@linnlabs/linnkit'
    || importPath.startsWith('@linnlabs/linnkit/')
  ) {
    return true;
  }

  return false;
}

function analyzeLegacyWorkspaceVfsPolicyImportRule(
  file: string,
  line: number,
  preview: string,
  importPath: string,
): Violation[] {
  const resolvedImportPath = normalizeResolvedImportPath(file, importPath);
  const normalizedImportPath = stripKnownExtension(normalizeFilePath(importPath));
  const isLegacyPolicyImport =
    normalizedImportPath === LEGACY_WORKSPACE_VFS_NODE_ACCESS_POLICY_SOURCE
    || resolvedImportPath === LEGACY_WORKSPACE_VFS_NODE_ACCESS_POLICY_SOURCE;
  if (!isLegacyPolicyImport) {
    return [];
  }

  return [
    createViolation('PLUGIN-GUARD-01-no-legacy-vfs-policy-import', file, line, preview, importPath),
  ];
}

function analyzePluginWorkspaceRuntimeMindmapAccessRule(
  file: string,
  line: number,
  preview: string,
  importPath: string,
): Violation[] {
  const resolvedImportPath = normalizeResolvedImportPath(file, importPath);
  const normalizedImportPath = stripKnownExtension(normalizeFilePath(importPath));
  const normalizedFilePath = stripKnownExtension(normalizeFilePath(file));
  const importsWorkspaceRuntime =
    normalizedImportPath === '@plugin/backend/workspaceRuntime'
    || normalizedImportPath === PLUGIN_SDK_BACKEND_WORKSPACE_RUNTIME_SOURCE
    || resolvedImportPath === PLUGIN_SDK_BACKEND_WORKSPACE_RUNTIME_SOURCE;
  const isWorkspaceRuntimeSdkFile = normalizedFilePath === PLUGIN_SDK_BACKEND_WORKSPACE_RUNTIME_SOURCE;
  if (!importsWorkspaceRuntime && !isWorkspaceRuntimeSdkFile) {
    return [];
  }

  if (!MINDMAP_RUNTIME_ACCESS_SYMBOLS.some(symbol => preview.includes(symbol))) {
    return [];
  }

  return [
    createViolation('PLUGIN-GUARD-02-no-plugin-specific-runtime-access-in-workspace-runtime', file, line, preview, importPath),
  ];
}

function normalizeHostRegistryTypesImportPath(file: string, importPath: string): string {
  const normalizedImportPath = stripKnownExtension(normalizeFilePath(importPath));
  if (normalizedImportPath.startsWith('src/')) {
    return normalizedImportPath;
  }

  if (normalizedImportPath.startsWith('.')) {
    const resolvedPath = path.resolve(repoRoot, path.dirname(file), normalizedImportPath);
    return stripKnownExtension(rel(resolvedPath));
  }

  return normalizedImportPath;
}

function analyzeSdkPluginContributionHostRegistryTypesRule(
  file: string,
  line: number,
  preview: string,
  importPath: string,
): Violation[] {
  const normalizedFilePath = stripKnownExtension(normalizeFilePath(file));
  if (normalizedFilePath !== PLUGIN_SDK_BACKEND_PLUGIN_CONTRIBUTION_SOURCE) {
    return [];
  }

  const normalizedImportPath = normalizeHostRegistryTypesImportPath(file, importPath);
  if (normalizedImportPath !== HOST_PLUGIN_REGISTRY_TYPES_SOURCE) {
    return [];
  }

  return [
    createViolation('PLUGIN-GUARD-08-no-sdk-plugin-contribution-host-registry-types', file, line, preview, importPath),
  ];
}

function analyzeRendererSdkPluginContributionHostTypesRule(
  file: string,
  line: number,
  preview: string,
  importPath: string,
): Violation[] {
  const normalizedFilePath = stripKnownExtension(normalizeFilePath(file));
  if (normalizedFilePath !== PLUGIN_SDK_RENDERER_PLUGIN_CONTRIBUTION_SOURCE) {
    return [];
  }

  const normalizedImportPath = stripKnownExtension(normalizeFilePath(importPath));
  if (normalizedImportPath !== HOST_RENDERER_PLUGIN_TYPES_IMPORT) {
    return [];
  }

  return [
    createViolation('PLUGIN-GUARD-09-no-renderer-sdk-plugin-contribution-host-types', file, line, preview, importPath),
  ];
}

function analyzeRendererSdkPortHostDomainImportRule(
  file: string,
  line: number,
  preview: string,
  importPath: string,
): Violation[] {
  const normalizedFilePath = stripKnownExtension(normalizeFilePath(file));
  if (!PLUGIN_SDK_RENDERER_PORT_SOURCES.has(normalizedFilePath)) {
    return [];
  }

  const normalizedImportPath = stripKnownExtension(normalizeFilePath(importPath));
  const importsHostDomainRuntime =
    normalizedImportPath.startsWith('@/domains/')
    || normalizedImportPath.startsWith('@/shared/composables/');
  if (!importsHostDomainRuntime) {
    return [];
  }

  return [
    createViolation('PLUGIN-GUARD-10-no-renderer-sdk-port-host-domain-import', file, line, preview, importPath),
  ];
}
