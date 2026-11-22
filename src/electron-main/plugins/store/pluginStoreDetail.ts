import { errorToString as readErrorMessage } from '@linnya/foundation';
import fs from 'node:fs';
import path from 'node:path';
import {
  parsePluginManifest,
  type PluginStateView,
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
  /** 安装包内远程分发插件的 plugin.json 声明目录；未安装时用于展示介绍、技能与智能体。 */
  readonly declarationRoot?: string | null;
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

/** 声明只有 plugin.json，不代表安装后体积；大小由商店从已验签 catalog 展示。 */
function readDeclaredDetail(baseDetail: PluginStoreDetail, options: PluginStoreDetailOptions): PluginStoreDetail | null {
  if (!options.declarationRoot) return null;
  const directory = path.join(options.declarationRoot, baseDetail.meta.id);
  if (!fs.existsSync(path.join(directory, 'plugin.json'))) return null;
  try {
    const manifest = readManifestFromPluginDir(directory);
    if (manifest.id !== baseDetail.meta.id) throw new Error(`plugin.json id 不匹配: ${manifest.id}`);
    return {
      ...baseDetail,
      homepage: manifest.homepage,
      details: manifest.details,
      releaseNotes: manifest.releaseNotes,
      skills: manifest.skills,
      agents: manifest.agents,
    };
  } catch (error) {
    report(options.reportDiagnostic, baseDetail.meta.id, `读取插件声明失败: ${readErrorMessage(error)}`);
    return null;
  }
}

export function buildPluginStoreDetail(
  state: PluginStateView,
  options: PluginStoreDetailOptions
): PluginStoreDetail {
  const baseDetail: PluginStoreDetail = {
    ...state,
    bundledSourceAvailable:
      resolveBundledPluginDirById(options.bundledPluginRoot, state.meta.id) !== null,
  };

  if (state.state === 'missing') {
    if (!baseDetail.bundledSourceAvailable) {
      const declared = readDeclaredDetail(baseDetail, options);
      if (declared) return declared;
    }
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
