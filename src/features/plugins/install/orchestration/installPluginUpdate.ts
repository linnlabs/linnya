import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { ZodError } from 'zod';

import {
  isValidRendererUiCompatibilityRange,
  parsePluginManifest,
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
  RemotePluginVersionManifest,
} from '../definitions/pluginInstall';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
      throw new Error(formatPluginManifestError(error));
    }
    throw error;
  }
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`latest.json 缺少字段: ${key}`);
  }
  return value.trim();
}

function normalizeRemoteVersion(input: string): string {
  const version = input.trim();
  if (!/^\d+(?:\.\d+)*$/.test(version)) {
    throw new Error('latest.json version 必须是数字点分版本号');
  }
  return version;
}

function parseRemotePluginVersionManifest(input: unknown): RemotePluginVersionManifest {
  if (!isRecord(input)) {
    throw new Error('latest.json 必须是对象');
  }

  const minApp = input.minApp;
  if (minApp !== undefined && typeof minApp !== 'string') {
    throw new Error('latest.json minApp 必须是字符串');
  }
  const rendererUi = input.rendererUi;
  if (rendererUi !== undefined && typeof rendererUi !== 'string') {
    throw new Error('latest.json rendererUi 必须是字符串');
  }
  if (typeof rendererUi === 'string' && !isValidRendererUiCompatibilityRange(rendererUi)) {
    throw new Error('latest.json rendererUi 必须是有效的 node-semver range');
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
    throw new Error('latest.json sha512 必须是 128 位十六进制字符串');
  }
  return candidate;
}

function sha512Hex(buffer: Buffer): string {
  return createHash('sha512').update(buffer).digest('hex');
}

function assertHttpUrl(rawUrl: string, label: string): void {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`${label} 只允许 http/https URL`);
  }
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
    throw new Error('active.json 必须声明非空 version');
  }
  return parsed.version;
}

function resolveInsideDirectory(rootDir: string, relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`插件 zip 路径不能越界: ${relativePath}`);
  }

  const resolved = path.resolve(rootDir, ...normalized.split('/'));
  const relative = path.relative(rootDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`插件 zip 路径不能越界: ${relativePath}`);
  }
  return resolved;
}

async function fetchJson(fetcher: typeof fetch, url: string): Promise<unknown> {
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`请求 latest.json 失败: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<unknown>;
}

async function fetchZipBuffer(fetcher: typeof fetch, url: string): Promise<Buffer> {
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`下载插件 artifact 失败: ${response.status} ${response.statusText}`);
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
    throw new Error(`${pluginId}@${version} 同版本 artifact 的 SHA512SUMS 不一致，请提升插件版本`);
  }
}

function validateExtractedPlugin(extractDir: string, pluginId: string, version: string): PluginManifest {
  const manifestPath = path.join(extractDir, 'plugin.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('插件 artifact 缺少 plugin.json');
  }

  const manifest = parseRemoteArtifactManifest(
    JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown
  );
  if (manifest.id !== pluginId || manifest.version !== version) {
    throw new Error(
      `插件 artifact manifest 不匹配: expected=${pluginId}@${version}, actual=${manifest.id}@${manifest.version}`
    );
  }

  if (
    manifest.entry.backend &&
    !fs.existsSync(resolveInsideDirectory(extractDir, manifest.entry.backend))
  ) {
    throw new Error(`插件 artifact 缺少 backend 入口: ${manifest.entry.backend}`);
  }
  if (
    manifest.entry.renderer &&
    !fs.existsSync(resolveInsideDirectory(extractDir, manifest.entry.renderer))
  ) {
    throw new Error(`插件 artifact 缺少 renderer 入口: ${manifest.entry.renderer}`);
  }
  return manifest;
}

async function extractZipToDirectory(zipPath: string, targetDir: string): Promise<void> {
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
  error: string
): CheckPluginRemoteUpdateResult {
  return {
    status: 'failed',
    pluginId: options.pluginId,
    currentVersion: options.currentVersion,
    latestVersion,
    error,
  };
}

export async function checkPluginUpdateFromRemote(
  options: CheckPluginRemoteUpdateOptions
): Promise<CheckPluginRemoteUpdateResult> {
  const fetcher = options.fetch ?? globalThis.fetch;
  if (!fetcher) {
    return toRemoteUpdateCheckFailure(options, null, '当前运行环境不支持 fetch');
  }

  let remote: RemotePluginVersionManifest | null = null;
  try {
    assertHttpUrl(options.latestManifestUrl, 'latestManifestUrl');
    remote = parseRemotePluginVersionManifest(await fetchJson(fetcher, options.latestManifestUrl));
    assertHttpUrl(remote.url, 'latest.json url');
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
      throw new Error(
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
    return toRemoteUpdateCheckFailure(options, remote?.version ?? null, readErrorMessage(error));
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
    };
  }

  const pluginInstallDir = path.join(options.userPluginRoot, options.pluginId);
  let tempInstallDir: string | null = null;

  try {
    assertHttpUrl(options.latestManifestUrl, 'latestManifestUrl');
    const remote = parseRemotePluginVersionManifest(
      await fetchJson(fetcher, options.latestManifestUrl)
    );
    assertHttpUrl(remote.url, 'latest.json url');

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
        throw new Error(`目标版本目录已存在但 manifest 不匹配: ${targetVersionDir}`);
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
      throw new Error(
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
      throw new Error(
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
    return {
      status: 'failed',
      pluginId: options.pluginId,
      version: null,
      error: readErrorMessage(error),
    };
  }
}
