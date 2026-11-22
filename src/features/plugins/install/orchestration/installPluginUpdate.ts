import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { ZodError } from 'zod';

import {
  isValidRendererUiCompatibilityRange,
  parsePluginManifest,
  type PluginOperationErrorCode,
  type PluginManifest,
} from '@app/schemas';
import { compareDottedVersions } from '../../functions/comparePluginVersions';
import { readPluginArtifactIdentity } from '../functions/readPluginArtifactIdentity';
import { evaluateRemotePluginCompatibility } from '../functions/evaluateRemotePluginCompatibility';
import type {
  CheckPluginRemoteUpdateOptions,
  CheckPluginRemoteUpdateResult,
  InstallPluginUpdateOptions,
  InstallPluginUpdateResult,
  RemotePluginRelease,
  RemotePluginReleaseSource,
  RemotePluginVersionManifest,
} from '../definitions/pluginInstall';
import { writePluginInstallReceipt } from '../../catalog/infrastructure/pluginInstallReceiptStore';
import { isRecord } from '@linnya/foundation';
import { PluginOperationError, toPluginOperationError } from '../definitions/pluginOperationError';

function formatPluginManifestError(error: ZodError): string {
  const fields = error.issues
    .map(issue => issue.path.join('.') || 'plugin.json')
    .filter((field, index, allFields) => allFields.indexOf(field) === index);
  if (fields.length === 0) {
    return '远程插件包 manifest 不兼容或过旧，请更新插件源后重试。';
  }
  return `远程插件包 manifest 不兼容或过旧，缺失或非法字段：${fields.join('、')}。请更新插件源后重试。`;
}

function parseRemoteArtifactManifest(input: unknown): PluginManifest {
  try {
    return parsePluginManifest(input);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new PluginOperationError('incompatible', formatPluginManifestError(error));
    }
    throw error;
  }
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PluginOperationError('incompatible', `latest.json 缺少字段: ${key}`);
  }
  return value.trim();
}

function normalizeRemoteVersion(input: string): string {
  const version = input.trim();
  if (!/^\d+(?:\.\d+)*$/.test(version)) {
    throw new PluginOperationError('incompatible', 'latest.json version 必须是数字点分版本号');
  }
  return version;
}

function parseRemotePluginVersionManifest(input: unknown): RemotePluginVersionManifest {
  if (!isRecord(input)) {
    throw new PluginOperationError('incompatible', 'latest.json 必须是对象');
  }

  const minApp = input.minApp;
  if (minApp !== undefined && typeof minApp !== 'string') {
    throw new PluginOperationError('incompatible', 'latest.json minApp 必须是字符串');
  }
  const rendererUi = input.rendererUi;
  if (rendererUi !== undefined && typeof rendererUi !== 'string') {
    throw new PluginOperationError('incompatible', 'latest.json rendererUi 必须是字符串');
  }
  if (typeof rendererUi === 'string' && !isValidRendererUiCompatibilityRange(rendererUi)) {
    throw new PluginOperationError('incompatible', 'latest.json rendererUi 必须是有效的 node-semver range');
  }

  return {
    version: normalizeRemoteVersion(readRequiredString(input, 'version')),
    minApp,
    rendererUi,
    url: readRequiredString(input, 'url'),
    sha512: readRequiredString(input, 'sha512'),
  };
}

function normalizeSha512(input: string): string {
  const candidate = input.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  if (!/^[a-f0-9]{128}$/.test(candidate)) {
    throw new PluginOperationError('incompatible', 'latest.json sha512 必须是 128 位十六进制字符串');
  }
  return candidate;
}

function sha512Hex(buffer: Buffer): string {
  return createHash('sha512').update(buffer).digest('hex');
}

function assertHttpUrl(rawUrl: string, label: string): void {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new PluginOperationError('source-unavailable', `${label} 只允许 http/https URL`);
  }
}

async function resolveRemoteRelease(
  options: {
    readonly pluginId: InstallPluginUpdateOptions['pluginId'];
    readonly appVersion: string;
    readonly rendererUiVersion: string;
    readonly latestManifestUrl?: string;
    readonly releaseSource?: RemotePluginReleaseSource;
  },
  fetcher: typeof fetch,
): Promise<RemotePluginRelease> {
  if (options.releaseSource) {
    const release = await options.releaseSource.resolve({
      pluginId: options.pluginId,
      appVersion: options.appVersion,
      rendererUiVersion: options.rendererUiVersion,
      fetch: fetcher,
    });
    assertHttpUrl(release.url, 'release url');
    normalizeSha512(release.sha512);
    return release;
  }
  if (!options.latestManifestUrl) {
    throw new PluginOperationError('source-unavailable', '未配置插件远程版本来源', { pluginId: options.pluginId });
  }
  // 未签名 latest.json 只证明下载字节与清单一致，只用于开发与 R2 smoke，不产生安装回执。
  assertHttpUrl(options.latestManifestUrl, 'latestManifestUrl');
  const remote = parseRemotePluginVersionManifest(await fetchJson(fetcher, options.latestManifestUrl));
  assertHttpUrl(remote.url, 'latest.json url');
  return remote;
}

function recordCatalogInstallReceipt(
  pluginInstallDir: string,
  pluginId: string,
  release: RemotePluginRelease,
  targetVersionDir: string,
  artifactSha512: string,
): void {
  if (!release.provenance) return;
  writePluginInstallReceipt(pluginInstallDir, {
    schemaVersion: 1,
    source: 'catalog-official',
    pluginId,
    version: release.version,
    artifactSha512,
    artifactIdentity: readPluginArtifactIdentity(targetVersionDir),
    installedAt: new Date().toISOString(),
    catalog: {
      keyId: release.provenance.keyId,
      digest: release.provenance.digest,
      sequence: release.provenance.sequence,
      envelope: release.provenance.envelope,
    },
  });
}

function readActiveVersion(pluginInstallDir: string): string | null {
  const activePath = path.join(pluginInstallDir, 'active.json');
  if (!fs.existsSync(activePath)) return null;
  const parsed = JSON.parse(fs.readFileSync(activePath, 'utf8')) as unknown;
  if (
    !isRecord(parsed) ||
    typeof parsed.version !== 'string' ||
    parsed.version.trim().length === 0
  ) {
    throw new PluginOperationError('unknown', 'active.json 必须声明非空 version');
  }
  return parsed.version;
}

function resolveInsideDirectory(rootDir: string, relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new PluginOperationError('artifact-integrity', `插件 zip 路径不能越界: ${relativePath}`);
  }

  const resolved = path.resolve(rootDir, ...normalized.split('/'));
  const relative = path.relative(rootDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new PluginOperationError('artifact-integrity', `插件 zip 路径不能越界: ${relativePath}`);
  }
  return resolved;
}

async function fetchJson(fetcher: typeof fetch, url: string): Promise<unknown> {
  const response = await fetcher(url);
  if (!response.ok) {
    throw new PluginOperationError(
      'source-unavailable',
      `请求 latest.json 失败: ${response.status} ${response.statusText}`,
    );
  }
  return response.json() as Promise<unknown>;
}

async function fetchZipBuffer(fetcher: typeof fetch, url: string): Promise<Buffer> {
  const response = await fetcher(url);
  if (!response.ok) {
    throw new PluginOperationError(
      'source-unavailable',
      `下载插件 artifact 失败: ${response.status} ${response.statusText}`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

function readExistingStagedVersion(
  targetVersionDir: string,
  pluginId: string,
  version: string
): boolean {
  const manifestPath = path.join(targetVersionDir, 'plugin.json');
  if (!fs.existsSync(manifestPath)) return false;
  const manifest = parseRemoteArtifactManifest(
    JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown
  );
  return manifest.id === pluginId && manifest.version === version;
}

function assertExistingStagedVersionIdentity(
  extractedVersionDir: string,
  targetVersionDir: string,
  pluginId: string,
  version: string
): void {
  const extractedIdentity = readPluginArtifactIdentity(extractedVersionDir);
  const existingIdentity = readPluginArtifactIdentity(targetVersionDir);
  if (extractedIdentity !== existingIdentity) {
    throw new PluginOperationError(
      'version-conflict',
      `${pluginId}@${version} 同版本 artifact 的 SHA512SUMS 不一致，请提升插件版本`,
      { pluginId },
    );
  }
}

function validateExtractedPlugin(extractDir: string, pluginId: string, version: string): PluginManifest {
  const manifestPath = path.join(extractDir, 'plugin.json');
  if (!fs.existsSync(manifestPath)) {
    throw new PluginOperationError('artifact-integrity', '插件 artifact 缺少 plugin.json', { pluginId });
  }

  const manifest = parseRemoteArtifactManifest(
    JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown
  );
  if (manifest.id !== pluginId || manifest.version !== version) {
    throw new PluginOperationError(
      'artifact-integrity',
      `插件 artifact manifest 不匹配: expected=${pluginId}@${version}, actual=${manifest.id}@${manifest.version}`
    );
  }

  if (
    manifest.entry.backend &&
    !fs.existsSync(resolveInsideDirectory(extractDir, manifest.entry.backend))
  ) {
    throw new PluginOperationError('artifact-integrity', `插件 artifact 缺少 backend 入口: ${manifest.entry.backend}`, { pluginId });
  }
  if (
    manifest.entry.renderer &&
    !fs.existsSync(resolveInsideDirectory(extractDir, manifest.entry.renderer))
  ) {
    throw new PluginOperationError('artifact-integrity', `插件 artifact 缺少 renderer 入口: ${manifest.entry.renderer}`, { pluginId });
  }
  return manifest;
}

/** 解压时每个条目都限定在目标目录内；供插件与运行时组件安装共用。 */
export async function extractZipToDirectory(zipPath: string, targetDir: string): Promise<void> {
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const entries = Object.values(zip.files);

  for (const entry of entries) {
    const targetPath = resolveInsideDirectory(targetDir, entry.name);
    if (entry.dir) {
      fs.mkdirSync(targetPath, { recursive: true });
      continue;
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, await entry.async('nodebuffer'));
  }
}

function makeTempInstallDir(pluginInstallDir: string, version: string): string {
  return path.join(pluginInstallDir, `.install-${version}.${process.pid}.${Date.now()}`);
}

function classifyCurrentVersion(
  currentVersion: string | null,
  remote: RemotePluginVersionManifest
): InstallPluginUpdateResult | null {
  if (!currentVersion) return null;
  const comparison = compareDottedVersions(currentVersion, remote.version);
  if (comparison === null) {
    return {
      status: 'failed',
      pluginId: 'unknown',
      version: remote.version,
      error: `无法比较插件版本: current=${currentVersion}, remote=${remote.version}`,
      errorCode: 'unknown',
    };
  }
  if (comparison >= 0) {
    return {
      status: 'skipped',
      pluginId: 'unknown',
      version: remote.version,
      reason: 'current',
    };
  }
  return null;
}

function toRemoteUpdateCheckFailure(
  options: CheckPluginRemoteUpdateOptions,
  latestVersion: string | null,
  error: string,
  errorCode: PluginOperationErrorCode,
): CheckPluginRemoteUpdateResult {
  return {
    status: 'failed',
    pluginId: options.pluginId,
    currentVersion: options.currentVersion,
    latestVersion,
    error,
    errorCode,
  };
}

export async function checkPluginUpdateFromRemote(
  options: CheckPluginRemoteUpdateOptions
): Promise<CheckPluginRemoteUpdateResult> {
  const fetcher = options.fetch ?? globalThis.fetch;
  if (!fetcher) {
    return toRemoteUpdateCheckFailure(options, null, '当前运行环境不支持 fetch', 'source-unavailable');
  }

  let remote: RemotePluginVersionManifest | null = null;
  try {
    remote = await resolveRemoteRelease(options, fetcher);
    normalizeSha512(remote.sha512);

    const compatibility = evaluateRemotePluginCompatibility({
      appVersion: options.appVersion,
      rendererUiVersion: options.rendererUiVersion,
      requirement: remote,
    });
    if (!compatibility.compatible) {
      return {
        status: 'incompatible',
        pluginId: options.pluginId,
        currentVersion: options.currentVersion,
        latestVersion: remote.version,
        detail: compatibility.detail,
      };
    }

    if (!options.currentVersion) {
      return {
        status: 'available',
        pluginId: options.pluginId,
        currentVersion: null,
        latestVersion: remote.version,
        ...(remote.minApp ? { minApp: remote.minApp } : {}),
        ...(remote.rendererUi ? { rendererUi: remote.rendererUi } : {}),
      };
    }

    const comparison = compareDottedVersions(options.currentVersion, remote.version);
    if (comparison === null) {
      throw new PluginOperationError(
        'unknown',
        `无法比较插件版本: current=${options.currentVersion}, remote=${remote.version}`
      );
    }

    if (comparison >= 0) {
      return {
        status: 'current',
        pluginId: options.pluginId,
        currentVersion: options.currentVersion,
        latestVersion: remote.version,
      };
    }

    return {
      status: 'available',
      pluginId: options.pluginId,
      currentVersion: options.currentVersion,
      latestVersion: remote.version,
      ...(remote.minApp ? { minApp: remote.minApp } : {}),
      ...(remote.rendererUi ? { rendererUi: remote.rendererUi } : {}),
    };
  } catch (error) {
    const operationError = toPluginOperationError(error, {
      pluginId: options.pluginId,
    });
    return toRemoteUpdateCheckFailure(
      options,
      remote?.version ?? null,
      operationError.message,
      operationError.code,
    );
  }
}

export async function installPluginUpdateFromRemote(
  options: InstallPluginUpdateOptions
): Promise<InstallPluginUpdateResult> {
  const fetcher = options.fetch ?? globalThis.fetch;
  if (!fetcher) {
    return {
      status: 'failed',
      pluginId: options.pluginId,
      version: null,
      error: '当前运行环境不支持 fetch',
      errorCode: 'source-unavailable',
    };
  }

  const pluginInstallDir = path.join(options.userPluginRoot, options.pluginId);
  let tempInstallDir: string | null = null;

  try {
    const remote = await resolveRemoteRelease(options, fetcher);

    const compatibility = evaluateRemotePluginCompatibility({
      appVersion: options.appVersion,
      rendererUiVersion: options.rendererUiVersion,
      requirement: remote,
    });
    if (!compatibility.compatible) {
      return {
        status: 'skipped',
        pluginId: options.pluginId,
        version: remote.version,
        reason: 'incompatible',
        detail: compatibility.detail,
      };
    }

    if (remote.runtimes && remote.runtimes.length > 0) {
      // 运行时先于插件安装：插件已是当前版本但运行时缺失时，重装也能补齐运行时。
      if (!remote.provenance || !options.installRuntimes) {
        throw new PluginOperationError('incompatible', `${options.pluginId}@${remote.version} 需要的原生运行时没有可信安装途径`, { pluginId: options.pluginId });
      }
      await options.installRuntimes(remote.runtimes, remote.provenance);
    }

    const currentVersion = Object.prototype.hasOwnProperty.call(options, 'currentVersion')
      ? (options.currentVersion ?? null)
      : readActiveVersion(pluginInstallDir);
    const currentDecision = classifyCurrentVersion(currentVersion, remote);
    if (currentDecision) {
      return { ...currentDecision, pluginId: options.pluginId };
    }

    const targetVersionDir = path.join(pluginInstallDir, remote.version);
    if (fs.existsSync(targetVersionDir)) {
      if (!readExistingStagedVersion(targetVersionDir, options.pluginId, remote.version)) {
        throw new PluginOperationError(
          'version-conflict',
          `目标版本目录已存在但 manifest 不匹配: ${targetVersionDir}`,
          { pluginId: options.pluginId },
        );
      }
    }

    fs.mkdirSync(pluginInstallDir, { recursive: true });
    tempInstallDir = makeTempInstallDir(pluginInstallDir, remote.version);
    const tempExtractDir = path.join(tempInstallDir, 'extract');
    const tempZipPath = path.join(tempInstallDir, 'artifact.zip');
    fs.mkdirSync(tempExtractDir, { recursive: true });

    const zipBuffer = await fetchZipBuffer(fetcher, remote.url);
    const expectedSha512 = normalizeSha512(remote.sha512);
    const actualSha512 = sha512Hex(zipBuffer);
    if (actualSha512 !== expectedSha512) {
      throw new PluginOperationError(
        'artifact-integrity',
        `插件 artifact sha512 不匹配: expected=${expectedSha512}, actual=${actualSha512}`
      );
    }

    fs.writeFileSync(tempZipPath, zipBuffer);
    await extractZipToDirectory(tempZipPath, tempExtractDir);
    const extractedManifest = validateExtractedPlugin(tempExtractDir, options.pluginId, remote.version);
    if (
      extractedManifest.entry.renderer
      && remote.rendererUi !== extractedManifest.compat?.rendererUi
    ) {
      throw new PluginOperationError(
        'incompatible',
        `latest.json rendererUi 与插件 artifact 不一致: latest=${remote.rendererUi}, artifact=${extractedManifest.compat?.rendererUi}`
      );
    }

    if (fs.existsSync(targetVersionDir)) {
      assertExistingStagedVersionIdentity(
        tempExtractDir,
        targetVersionDir,
        options.pluginId,
        remote.version
      );
      fs.rmSync(tempInstallDir, { recursive: true, force: true });
      tempInstallDir = null;
      // 同字节的版本可能来自中断前的暂存，补写回执才能通过来源准入。
      recordCatalogInstallReceipt(pluginInstallDir, options.pluginId, remote, targetVersionDir, actualSha512);
      return {
        status: 'skipped',
        pluginId: options.pluginId,
        version: remote.version,
        reason: 'already-staged',
      };
    }

    fs.renameSync(tempExtractDir, targetVersionDir);
    fs.rmSync(tempInstallDir, { recursive: true, force: true });
    tempInstallDir = null;
    // 回执在激活之前落盘；崩溃在两者之间时，下次安装走 already-staged 补写。
    recordCatalogInstallReceipt(pluginInstallDir, options.pluginId, remote, targetVersionDir, actualSha512);

    return {
      status: 'staged',
      pluginId: options.pluginId,
      version: remote.version,
      previousVersion: currentVersion,
      stagedDir: targetVersionDir,
      restartRequired: true,
    };
  } catch (error) {
    if (tempInstallDir) {
      fs.rmSync(tempInstallDir, { recursive: true, force: true });
    }
    const operationError = toPluginOperationError(error, { pluginId: options.pluginId });
    return {
      status: 'failed',
      pluginId: options.pluginId,
      version: null,
      error: operationError.message,
      errorCode: operationError.code,
    };
  }
}
