import fs from 'node:fs';
import path from 'node:path';

import { isPluginUserRemoved } from '../../../features/plugins/install/functions/pluginRemovalMarker';
import { readPluginArtifactIdentity } from '../../../features/plugins/install/functions/readPluginArtifactIdentity';
import { compareDottedVersions } from '../../../features/plugins/functions/comparePluginVersions';
import { readJsonFile, readPluginManifestSummary } from './pluginLayout';

export type BundledPluginSeedStatus = 'staged' | 'update-staged' | 'already-active' | 'skipped';

export interface BundledPluginSeedResult {
  readonly pluginId: string;
  readonly version: string;
  readonly sourceDir: string;
  readonly targetDir: string;
  readonly status: BundledPluginSeedStatus;
  readonly reason?: string;
}

export interface SeedBundledPluginsOptions {
  readonly bundledPluginRoot: string | null;
  readonly userPluginRoot: string;
}

export interface StagedBundledPluginActivationCandidate {
  readonly pluginId: string;
  readonly version: string;
  readonly previousVersion: string | null;
  readonly pluginDir: string;
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

export interface BundledPluginRootCandidateInput {
  readonly explicitRoot: string | undefined;
  readonly includeImplicitPackagedRoots: boolean;
  readonly resourcesPath: string;
  readonly appPath: string;
  readonly workingDirectory: string;
}

export class RequiredBundledPluginSeedError extends Error {
  readonly failures: readonly BundledPluginSeedResult[];

  constructor(failures: readonly BundledPluginSeedResult[]) {
    super(
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

export class BundledPluginArtifactConflictError extends Error {
  constructor(pluginId: string, version: string, detail: string) {
    super(
      `[PluginRuntime] ${pluginId}@${version} 同版本 artifact 冲突：${detail}；版本目录不可覆盖，请提升插件版本`
    );
    this.name = 'BundledPluginArtifactConflictError';
  }
}

interface ActivePluginPointer {
  readonly version: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseActivePointer(input: unknown): ActivePluginPointer {
  if (!isRecord(input) || typeof input.version !== 'string' || input.version.trim().length === 0) {
    throw new Error('active.json 必须声明非空 version');
  }
  return { version: input.version };
}

function copyDirectoryAtomically(sourceDir: string, targetDir: string): void {
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  const tempDir = path.join(
    path.dirname(targetDir),
    `.${path.basename(targetDir)}.${process.pid}.${Date.now()}.tmp`
  );
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.cpSync(sourceDir, tempDir, {
    recursive: true,
    dereference: true,
  });
  fs.renameSync(tempDir, targetDir);
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
    copyDirectoryAtomically(sourceDir, targetVersionDir);
  }
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

  ensureSeedTargetVersionDir(sourceDir, targetVersionDir, manifest.id, manifest.version);

  return {
    pluginId: manifest.id,
    version: manifest.version,
    sourceDir,
    targetDir: targetVersionDir,
    status: 'staged',
  };
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
      if (error instanceof BundledPluginArtifactConflictError) {
        throw error;
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
  userPluginRoot: string
): StagedBundledPluginActivationCandidate | null {
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

  return {
    pluginId: manifest.id,
    version: manifest.version,
    previousVersion,
    pluginDir: targetVersionDir,
  };
}

export function listStagedBundledPluginActivationCandidates(
  options: SeedBundledPluginsOptions
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
      options.userPluginRoot
    );
    if (candidate) {
      candidates.push(candidate);
    }
  }
  return candidates;
}
