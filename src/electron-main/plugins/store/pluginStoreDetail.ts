import fs from 'node:fs';
import path from 'node:path';
import {
  parsePluginManifest,
  type PluginManifest,
  type PluginStoreDetail,
} from '@app/schemas';
import {
  type PluginLayoutDiagnosticReporter,
  readJsonFile,
  resolveInsidePluginDir,
  resolvePluginDirById,
} from '../loader/pluginLayout';

export interface PluginStoreDetailOptions {
  readonly pluginRoot?: string;
  readonly bundledPluginRoot?: string | null;
  readonly directPluginDirs?: readonly string[];
  readonly reportDiagnostic?: PluginLayoutDiagnosticReporter;
}

function report(
  reporter: PluginLayoutDiagnosticReporter | undefined,
  pluginId: string,
  message: string
): void {
  reporter?.({ pluginId, message });
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readManifestFromPluginDir(pluginDir: string) {
  return parsePluginManifest(readJsonFile(path.join(pluginDir, 'plugin.json')));
}

function resolveBundledPluginDirById(
  bundledPluginRoot: string | null | undefined,
  pluginId: string
): string | null {
  if (!bundledPluginRoot || !fs.existsSync(bundledPluginRoot)) {
    return null;
  }

  const pluginDir = resolveInsidePluginDir(bundledPluginRoot, pluginId, 'bundled plugin id');
  if (!fs.existsSync(path.join(pluginDir, 'plugin.json'))) {
    return null;
  }

  return pluginDir;
}

function readBundledDetailOrBase(
  baseDetail: PluginStoreDetail,
  bundledPluginRoot: string | null | undefined,
  options: PluginStoreDetailOptions
): PluginStoreDetail {
  const bundledPluginDir = resolveBundledPluginDirById(bundledPluginRoot, baseDetail.meta.id);
  if (!bundledPluginDir) {
    return baseDetail;
  }
  return readDetailFromPluginDir(baseDetail, bundledPluginDir, options);
}

function computeDirectorySizeBytes(directory: string): number {
  let sizeBytes = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    const stat = fs.lstatSync(entryPath);
    if (stat.isSymbolicLink()) {
      continue;
    }
    if (stat.isDirectory()) {
      sizeBytes += computeDirectorySizeBytes(entryPath);
    } else if (stat.isFile()) {
      sizeBytes += stat.size;
    }
  }
  return sizeBytes;
}

function buildDetailFromManifest(
  baseDetail: PluginStoreDetail,
  manifest: PluginManifest,
  pluginDir: string
): PluginStoreDetail {
  if (manifest.id !== baseDetail.meta.id) {
    throw new Error(`plugin.json id 不匹配: ${manifest.id}`);
  }

  return {
    ...baseDetail,
    sizeBytes: computeDirectorySizeBytes(pluginDir),
    homepage: manifest.homepage,
    details: manifest.details,
    releaseNotes: manifest.releaseNotes,
    skills: manifest.skills,
    agents: manifest.agents,
  };
}

function readDetailFromPluginDir(
  baseDetail: PluginStoreDetail,
  pluginDir: string,
  options: PluginStoreDetailOptions
): PluginStoreDetail {
  try {
    return buildDetailFromManifest(baseDetail, readManifestFromPluginDir(pluginDir), pluginDir);
  } catch (error) {
    report(options.reportDiagnostic, baseDetail.meta.id, `读取插件详情失败: ${readErrorMessage(error)}`);
    return baseDetail;
  }
}

export function buildPluginStoreDetail(
  state: PluginStoreDetail,
  options: PluginStoreDetailOptions
): PluginStoreDetail {
  const baseDetail: PluginStoreDetail = { ...state };

  if (state.state === 'missing') {
    return readBundledDetailOrBase(baseDetail, options.bundledPluginRoot, options);
  }

  const pluginDir = resolvePluginDirById({
    pluginId: state.meta.id,
    pluginRoot: options.pluginRoot,
    directPluginDirs: options.directPluginDirs,
    reportDiagnostic: options.reportDiagnostic,
  });
  if (!pluginDir) {
    // 中文说明：开发态或首次 seed 前，插件可能已经有已知 meta/状态，但用户 active 目录还未落盘。
    // 详情页仍应展示随包预置 manifest，而不是只剩版本和开发者。
    return readBundledDetailOrBase(baseDetail, options.bundledPluginRoot, options);
  }

  return readDetailFromPluginDir(baseDetail, pluginDir, options);
}
