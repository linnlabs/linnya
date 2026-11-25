import fs from 'node:fs';
import path from 'node:path';

import { parsePluginManifest, pluginMetaFromManifest, type PluginMeta } from '@app/schemas';
import { isPluginUserRemoved } from '../../../features/plugins/install/functions/pluginRemovalMarker';
import { assertBundledPluginArtifactIntegrity, readPluginArtifactIdentity } from '../../../features/plugins/install/functions/readPluginArtifactIdentity';
import { compareDottedVersions } from '@app/schemas';
import { readJsonFile, readPluginManifestSummary } from './pluginLayout';
import { isRecord, errorToString as readErrorMessage } from '@linnya/foundation';
import { PluginOperationError } from '../../../features/plugins/install/definitions/pluginOperationError';

export type BundledPluginSeedStatus = 'staged' | 'update-staged' | 'already-active' | 'skipped';

export interface BundledPluginSeedResult {
  readonly pluginId: string;
  readonly version: string;
  readonly sourceDir: string;
  readonly targetDir: string;
  readonly status: BundledPluginSeedStatus;
  readonly reason?: string;
  /** 本机同版本目录与随包 artifact 内容不一致：本次只跳过这个插件，版本目录保持原样。 */
  readonly conflict?: true;
}

export interface SeedBundledPluginsOptions {
  readonly bundledPluginRoot: string | null;
  readonly userPluginRoot: string;
}

interface StagedBundledActivationOptions extends SeedBundledPluginsOptions {
  readonly shouldRestoreOnDemandPlugin?: (pluginId: string) => boolean;
  readonly onStageFailure?: (pluginId: string, error: unknown) => void;
  /** 本机版本目录与随包 artifact 内容不一致：不激活该插件，由调用方记诊断。 */
  readonly onArtifactConflict?: (pluginId: string, error: BundledPluginArtifactConflictError) => void;
}

function isBundledInstallOnDemand(sourceDir: string): boolean {
  return fs.existsSync(path.join(sourceDir, '.install-on-demand'));
}

export interface ExplicitBundledPluginStageOptions {
  readonly bundledPluginRoot: string;
  readonly userPluginRoot: string;
  readonly pluginId: string;
}

export interface StagedBundledPluginActivationCandidate {
  readonly pluginId: string;
  readonly version: string;
  readonly previousVersion: string | null;
  readonly pluginDir: string;
}

export interface ExplicitBundledPluginStageCandidate extends StagedBundledPluginActivationCandidate {
  /** 本次显式安装实际创建的版本目录；失败时由生命周期编排负责回收。 */
  readonly createdVersionDir: boolean;
}

export interface PluginRuntimeEnvironmentResult {
  readonly userPluginRoot: string;
  readonly bundledPluginRoot: string | null;
  readonly seedResults: readonly BundledPluginSeedResult[];
  readonly backendLoadingMode: string | undefined;
}

/**
 * 读取发行组合层随包插件的身份，用于授予需要 Host 明确信任的能力。
 * Core 不维护具体插件名单；清单完全来自当前解析到的 bundled artifact 根目录。
 */
export function listBundledPluginManifestIds(bundledPluginRoot: string): string[] {
  if (!fs.existsSync(bundledPluginRoot)) return [];
  return fs.readdirSync(bundledPluginRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const manifest = readPluginManifestSummary(path.join(bundledPluginRoot, entry.name));
      return manifest ? [manifest.id] : [];
    });
}

/** Read bundled metadata without loading backend code so a user-removed plugin remains visible. */
export function listBundledPluginMetas(bundledPluginRoot: string | null): PluginMeta[] {
  if (!bundledPluginRoot || !fs.existsSync(bundledPluginRoot)) return [];

  return fs.readdirSync(bundledPluginRoot, { withFileTypes: true }).flatMap(entry => {
    if (!entry.isDirectory()) return [];
    try {
      const pluginDir = path.join(bundledPluginRoot, entry.name);
      const manifest = parsePluginManifest(readJsonFile(path.join(pluginDir, 'plugin.json')));
      const summary = readPluginManifestSummary(pluginDir);
      return [pluginMetaFromManifest(manifest, {
        builtin: true,
        ...(summary?.required === undefined ? {} : { required: summary.required }),
      })];
    } catch {
      return [];
    }
  });
}

export interface BundledPluginRootCandidateInput {
  readonly explicitRoot: string | undefined;
  readonly includeImplicitPackagedRoots: boolean;
  readonly resourcesPath: string;
  readonly appPath: string;
  readonly workingDirectory: string;
}

export class RequiredBundledPluginSeedError extends PluginOperationError {
  readonly failures: readonly BundledPluginSeedResult[];

  constructor(failures: readonly BundledPluginSeedResult[]) {
    super(
      'source-unavailable',
      `[PluginRuntime] required bundled plugin seed failed: ${failures
        .map(
          failure => `${failure.pluginId}@${failure.version}: ${failure.reason ?? failure.status}`
        )
        .join('; ')}`
    );
    this.name = 'RequiredBundledPluginSeedError';
    this.failures = failures;
  }
}

export class BundledPluginArtifactConflictError extends PluginOperationError {
  readonly version: string;

  constructor(pluginId: string, version: string, detail: string) {
    super(
      'version-conflict',
      `[PluginRuntime] ${pluginId}@${version} 同版本 artifact 冲突：${detail}；版本目录不可覆盖，请提升插件版本`
      , { pluginId },
    );
    this.name = 'BundledPluginArtifactConflictError';
    this.version = version;
  }
}

interface ActivePluginPointer {
  readonly version: string;
}

function parseActivePointer(input: unknown): ActivePluginPointer {
  if (!isRecord(input) || typeof input.version !== 'string' || input.version.trim().length === 0) {
    throw new Error('active.json 必须声明非空 version');
  }
  return { version: input.version };
}

function translateBundledCopyFailure(error: unknown, destination: string, pluginId: string): unknown {
  // Windows 上 cpSync 在创建子目录时可能把 ERROR_DISK_FULL 映射为 EINPROGRESS。
  // 只在目标卷确实没有可用块时翻译，不能按本地化系统文案或单独凭底层码推断。
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'EINPROGRESS') return error;
  try {
    if (fs.statfsSync(destination).bavail === 0) {
      return new PluginOperationError('disk-space', error.message, { pluginId, cause: error });
    }
  } catch {
    // 卷状态不可读时保留原始复制错误。
  }
  return error;
}

function copyDirectoryAtomically(sourceDir: string, targetDir: string, pluginId: string): void {
  const destination = path.dirname(targetDir);
  fs.mkdirSync(destination, { recursive: true });
  const tempDir = path.join(
    destination,
    `.${path.basename(targetDir)}.${process.pid}.${Date.now()}.tmp`
  );
  fs.rmSync(tempDir, { recursive: true, force: true });
  try {
    fs.cpSync(sourceDir, tempDir, {
      recursive: true,
      dereference: true,
    });
    fs.renameSync(tempDir, targetDir);
  } catch (error) {
    // 清理部分产物可能会释放空间；先从失败时的卷状态确认原因。
    const failure = translateBundledCopyFailure(error, destination, pluginId);
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw failure;
  }
}

function assertExistingSeedTargetVersionIdentity(
  sourceDir: string,
  targetVersionDir: string,
  pluginId: string,
  version: string
): void {
  if (!fs.existsSync(targetVersionDir)) {
    return;
  }

  const existingManifest = readPluginManifestSummary(targetVersionDir);
  if (existingManifest?.id !== pluginId || existingManifest.version !== version) {
    throw new BundledPluginArtifactConflictError(
      pluginId,
      version,
      '目标版本目录的 manifest 身份不一致'
    );
  }

  let sourceIdentity: string;
  let targetIdentity: string;
  try {
    sourceIdentity = readPluginArtifactIdentity(sourceDir);
    targetIdentity = readPluginArtifactIdentity(targetVersionDir);
  } catch (error) {
    throw new BundledPluginArtifactConflictError(pluginId, version, readErrorMessage(error));
  }
  if (sourceIdentity !== targetIdentity) {
    throw new BundledPluginArtifactConflictError(pluginId, version, 'SHA512SUMS 不一致');
  }
}

function ensureSeedTargetVersionDir(
  sourceDir: string,
  targetVersionDir: string,
  pluginId: string,
  version: string
): void {
  assertExistingSeedTargetVersionIdentity(sourceDir, targetVersionDir, pluginId, version);
  if (!fs.existsSync(targetVersionDir)) {
    copyDirectoryAtomically(sourceDir, targetVersionDir, pluginId);
  }
}

/**
 * Stage one user-requested bundled plugin. Startup seed intentionally respects the
 * user-removed marker; an explicit install is the only path that may bypass it.
 * The marker is cleared by the caller only after migrations and active activation succeed.
 */
export function stageBundledPluginForExplicitInstall(
  options: ExplicitBundledPluginStageOptions,
): ExplicitBundledPluginStageCandidate {
  const bundledRoot = path.resolve(options.bundledPluginRoot);
  const sourceDir = fs.readdirSync(bundledRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(bundledRoot, entry.name))
    .find(candidate => readPluginManifestSummary(candidate)?.id === options.pluginId);
  if (!sourceDir) {
    throw new PluginOperationError(
      'source-unavailable',
      `随包插件 artifact 不存在或 manifest 不匹配: ${options.pluginId}`,
      { pluginId: options.pluginId },
    );
  }
  const manifest = readPluginManifestSummary(sourceDir);
  if (!manifest) {
    throw new PluginOperationError(
      'artifact-integrity',
      `随包插件 artifact manifest 不可读: ${options.pluginId}`,
      { pluginId: options.pluginId },
    );
  }
  // 校验在覆盖旧残留、复制或写 SQLite 之前完成；失败时用户仍可修复来源再重试。
  assertBundledPluginArtifactIntegrity(sourceDir, Object.values(manifest.entry).filter(value => value !== undefined));

  const pluginInstallDir = path.join(options.userPluginRoot, manifest.id);
  const targetVersionDir = path.join(pluginInstallDir, manifest.version);
  const activePath = path.join(pluginInstallDir, 'active.json');
  const activeExists = fs.existsSync(activePath);
  const targetExists = fs.existsSync(targetVersionDir);

  // 卸载后没有 active 指针，说明该版本目录只能是上一次失败安装留下的
  // 临时结果；允许这次显式安装用经过校验的 bundled artifact 覆盖它。
  if (!activeExists && targetExists) {
    fs.rmSync(targetVersionDir, { recursive: true, force: true });
  }
  ensureSeedTargetVersionDir(sourceDir, targetVersionDir, manifest.id, manifest.version);

  let previousVersion: string | null = null;
  if (activeExists) {
    previousVersion = parseActivePointer(readJsonFile(activePath)).version;
  }

  return {
    pluginId: manifest.id,
    version: manifest.version,
    previousVersion,
    pluginDir: targetVersionDir,
    createdVersionDir: !activeExists || !targetExists,
  };
}

function isBundledPluginRoot(directory: string): boolean {
  if (!fs.existsSync(directory)) return false;
  const stat = fs.statSync(directory);
  if (!stat.isDirectory()) return false;

  return fs
    .readdirSync(directory, { withFileTypes: true })
    .some(
      entry => entry.isDirectory() && fs.existsSync(path.join(directory, entry.name, 'plugin.json'))
    );
}

export function findBundledPluginRootFromCandidates(candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    if (isBundledPluginRoot(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function buildBundledPluginRootCandidates(input: BundledPluginRootCandidateInput): string[] {
  const candidates: string[] = [];
  if (input.explicitRoot) {
    candidates.push(input.explicitRoot);
  }

  // inline/source 开发态的插件集合由当前 registry 明确装配。仓库 extraResources
  // 是可残留的构建输出，不能成为日常开发启动的隐式插件来源。
  if (!input.includeImplicitPackagedRoots) {
    return candidates;
  }

  candidates.push(
    path.join(input.resourcesPath, 'plugins'),
    path.join(input.resourcesPath, 'app', 'extraResources', 'plugins'),
    path.join(input.resourcesPath, 'app.asar.unpacked', 'extraResources', 'plugins'),
    path.join(input.workingDirectory, 'extraResources', 'plugins'),
    path.join(input.appPath, 'extraResources', 'plugins'),
    path.resolve(input.appPath, '../../extraResources/plugins')
  );

  return Array.from(new Set(candidates));
}

function seedSingleBundledPlugin(
  sourceDir: string,
  userPluginRoot: string
): BundledPluginSeedResult | null {
  const manifest = readPluginManifestSummary(sourceDir);
  if (!manifest) {
    return null;
  }

  const pluginInstallDir = path.join(userPluginRoot, manifest.id);
  const activePath = path.join(pluginInstallDir, 'active.json');
  const targetVersionDir = path.join(pluginInstallDir, manifest.version);

  if (isPluginUserRemoved(userPluginRoot, manifest.id)) {
    return {
      pluginId: manifest.id,
      version: manifest.version,
      sourceDir,
      targetDir: targetVersionDir,
      status: 'skipped',
      reason: '用户已卸载该预置插件，跳过自动 seed',
    };
  }

  if (fs.existsSync(activePath)) {
    const active = parseActivePointer(readJsonFile(activePath));
    const versionComparison = compareDottedVersions(active.version, manifest.version);
    if (versionComparison === null) {
      return {
        pluginId: manifest.id,
        version: manifest.version,
        sourceDir,
        targetDir: targetVersionDir,
        status: 'skipped',
        reason: `无法比较 active 插件版本，跳过预置升级: active=${active.version}, bundled=${manifest.version}`,
      };
    }

    if (versionComparison < 0) {
      ensureSeedTargetVersionDir(sourceDir, targetVersionDir, manifest.id, manifest.version);

      return {
        pluginId: manifest.id,
        version: manifest.version,
        sourceDir,
        targetDir: targetVersionDir,
        status: 'update-staged',
      };
    }

    if (versionComparison === 0) {
      ensureSeedTargetVersionDir(sourceDir, targetVersionDir, manifest.id, manifest.version);
    } else {
      assertExistingSeedTargetVersionIdentity(
        sourceDir,
        targetVersionDir,
        manifest.id,
        manifest.version
      );
    }

    return {
      pluginId: manifest.id,
      version: manifest.version,
      sourceDir,
      targetDir: targetVersionDir,
      status: 'already-active',
      reason:
        versionComparison > 0
          ? `active 版本 ${active.version} 高于预置版本 ${manifest.version}`
          : undefined,
    };
  }

  if (isBundledInstallOnDemand(sourceDir)) {
    return {
      pluginId: manifest.id, version: manifest.version, sourceDir, targetDir: targetVersionDir,
      status: 'skipped', reason: '随包插件按需安装',
    };
  }
  ensureSeedTargetVersionDir(sourceDir, targetVersionDir, manifest.id, manifest.version);
  return { pluginId: manifest.id, version: manifest.version, sourceDir, targetDir: targetVersionDir, status: 'staged' };
}

function listRequiredBundledPluginIds(bundledPluginRoot: string | null): Set<string> {
  const requiredIds = new Set<string>();
  if (!bundledPluginRoot || !fs.existsSync(bundledPluginRoot)) {
    return requiredIds;
  }

  for (const entry of fs.readdirSync(bundledPluginRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    try {
      const manifest = readPluginManifestSummary(path.join(bundledPluginRoot, entry.name));
      if (manifest?.required === true) {
        requiredIds.add(manifest.id);
      }
    } catch {
      // 中文说明：损坏的 manifest 会在 seedBundledPlugins 中变成具体 seed result；
      // 这里不抢先吞掉错误，也不把未知插件误判为 required。
    }
  }
  return requiredIds;
}

export function assertRequiredBundledPluginSeedSucceeded(options: {
  readonly bundledPluginRoot: string | null;
  readonly seedResults: readonly BundledPluginSeedResult[];
}): void {
  const requiredPluginIds = listRequiredBundledPluginIds(options.bundledPluginRoot);
  if (requiredPluginIds.size === 0) {
    return;
  }

  const failures = options.seedResults.filter(
    result => requiredPluginIds.has(result.pluginId) && result.status === 'skipped'
  );
  if (failures.length > 0) {
    throw new RequiredBundledPluginSeedError(failures);
  }
}

export function seedBundledPlugins(options: SeedBundledPluginsOptions): BundledPluginSeedResult[] {
  const bundledPluginRoot = options.bundledPluginRoot;
  if (!bundledPluginRoot || !fs.existsSync(bundledPluginRoot)) {
    return [];
  }

  const results: BundledPluginSeedResult[] = [];
  for (const entry of fs.readdirSync(bundledPluginRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const sourceDir = path.join(bundledPluginRoot, entry.name);
    try {
      const result = seedSingleBundledPlugin(sourceDir, options.userPluginRoot);
      if (result) {
        results.push(result);
      }
    } catch (error) {
      // 同版本内容冲突只拦这一个插件：不覆盖版本目录，也不把随包字节当成已装版本，
      // 其余随包插件照常准备。必需插件冲突由 assertRequiredBundledPluginSeedSucceeded 阻断启动。
      if (error instanceof BundledPluginArtifactConflictError) {
        const pluginId = error.pluginId ?? entry.name;
        results.push({
          pluginId,
          version: error.version,
          sourceDir,
          targetDir: path.join(options.userPluginRoot, pluginId, error.version),
          status: 'skipped',
          reason: error.message,
          conflict: true,
        });
        continue;
      }
      results.push({
        pluginId: entry.name,
        version: 'unknown',
        sourceDir,
        targetDir: path.join(options.userPluginRoot, entry.name),
        status: 'skipped',
        reason: readErrorMessage(error),
      });
    }
  }

  return results;
}

function findStagedBundledActivationCandidate(
  sourceDir: string,
  options: StagedBundledActivationOptions,
): StagedBundledPluginActivationCandidate | null {
  const { userPluginRoot } = options;
  const manifest = readPluginManifestSummary(sourceDir);
  if (!manifest) {
    return null;
  }

  if (isPluginUserRemoved(userPluginRoot, manifest.id)) {
    return null;
  }

  const pluginInstallDir = path.join(userPluginRoot, manifest.id);
  const activePath = path.join(pluginInstallDir, 'active.json');
  const targetVersionDir = path.join(pluginInstallDir, manifest.version);
  if (!fs.existsSync(activePath) && isBundledInstallOnDemand(sourceDir)) {
    // 早期 seed 不接触数据库；只有 Backend 确认真有资料后才复制并激活。
    try {
      if (!options.shouldRestoreOnDemandPlugin?.(manifest.id)) return null;
      assertBundledPluginArtifactIntegrity(sourceDir, Object.values(manifest.entry).filter(value => value !== undefined));
      ensureSeedTargetVersionDir(sourceDir, targetVersionDir, manifest.id, manifest.version);
    } catch (error) {
      options.onStageFailure?.(manifest.id, error);
      return null;
    }
  }
  const targetManifest = readPluginManifestSummary(targetVersionDir);
  if (targetManifest?.id !== manifest.id || targetManifest.version !== manifest.version) {
    return null;
  }

  let previousVersion: string | null = null;
  if (fs.existsSync(activePath)) {
    const active = parseActivePointer(readJsonFile(activePath));
    const versionComparison = compareDottedVersions(active.version, manifest.version);
    if (versionComparison === null || versionComparison >= 0) {
      return null;
    }
    previousVersion = active.version;
  }

  // seed 遇到同版本内容冲突只跳过这个插件；激活也不能把内容对不上的本机目录当成随包新版切过去。
  try {
    assertExistingSeedTargetVersionIdentity(sourceDir, targetVersionDir, manifest.id, manifest.version);
  } catch (error) {
    if (!(error instanceof BundledPluginArtifactConflictError)) throw error;
    options.onArtifactConflict?.(manifest.id, error);
    return null;
  }

  return {
    pluginId: manifest.id,
    version: manifest.version,
    previousVersion,
    pluginDir: targetVersionDir,
  };
}

export function listStagedBundledPluginActivationCandidates(
  options: StagedBundledActivationOptions,
): StagedBundledPluginActivationCandidate[] {
  const bundledPluginRoot = options.bundledPluginRoot;
  if (!bundledPluginRoot || !fs.existsSync(bundledPluginRoot)) {
    return [];
  }

  const candidates: StagedBundledPluginActivationCandidate[] = [];
  for (const entry of fs.readdirSync(bundledPluginRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidate = findStagedBundledActivationCandidate(
      path.join(bundledPluginRoot, entry.name),
      options,
    );
    if (candidate) {
      candidates.push(candidate);
    }
  }
  return candidates;
}
