import fs from 'node:fs';
import path from 'node:path';
import {
  isValidRendererUiCompatibilityRange,
  parsePluginRendererStylesheetManifest,
  PLUGIN_RENDERER_STYLESHEET_MANIFEST_PATH,
} from '@app/schemas';

import {
  type PluginLayoutDiagnosticReporter,
  discoverActivePluginDirsFromLayout,
  readJsonFile,
  readPluginManifestSummary,
  resolveInsidePluginDir,
} from './pluginLayout';

export interface RendererPluginEntry {
  readonly pluginId: string;
  readonly version: string;
  readonly rendererUiRange: string;
  readonly entryUrl: string;
  readonly cssUrls: readonly string[];
  readonly sourceKind?: 'direct' | 'official-source' | 'active';
  readonly pluginDir?: string;
  readonly entryPath?: string;
}

export interface RendererPluginEntryListOptions {
  readonly pluginRoot?: string;
  readonly directPluginDirs?: readonly string[];
  readonly officialPluginPackageDirs?: readonly string[];
  readonly preferSourceEntries?: boolean;
  readonly enabledIds: ReadonlySet<string>;
  readonly reportDiagnostic?: PluginLayoutDiagnosticReporter;
}

export interface RendererPluginEntryModeOptions {
  readonly rendererBundleMode?: string | null;
  readonly nodeEnv?: string | null;
  readonly linnyaDevMode?: string | null;
  readonly appIsPackaged: boolean;
}

export function shouldPreferSourceRendererPluginEntriesForEnvironment(
  options: RendererPluginEntryModeOptions,
): boolean {
  const rawMode = options.rendererBundleMode?.trim();
  if (rawMode === 'inline') return true;
  if (rawMode === 'disk') return false;

  return !options.appIsPackaged ||
    options.nodeEnv === 'development' ||
    options.linnyaDevMode === 'true';
}

export function discoverOfficialPluginPackageDirsFromWorkspace(
  repoRoot: string = process.cwd(),
  pluginIds?: readonly string[],
): string[] {
  const packageRoot = path.join(repoRoot, 'packages', 'plugins');
  if (!fs.existsSync(packageRoot)) return [];

  const resolvedPluginIds = pluginIds ?? fs.readdirSync(packageRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  return resolvedPluginIds
    .map((pluginId) => path.join(packageRoot, pluginId))
    .filter((pluginDir) => fs.existsSync(path.join(pluginDir, 'plugin.json')));
}

function toPluginUrlPath(pluginDir: string, relativePath: string, label: string): string {
  resolveInsidePluginDir(pluginDir, relativePath, label);
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/')) {
    throw new Error(`${label} 必须是插件目录内的相对路径`);
  }
  return normalized.split('/').map(encodeURIComponent).join('/');
}

function listRendererCssUrls(pluginDir: string, pluginId: string): string[] {
  const manifestPath = resolveInsidePluginDir(
    pluginDir,
    PLUGIN_RENDERER_STYLESHEET_MANIFEST_PATH,
    'renderer stylesheet manifest',
  );
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`renderer artifact 缺少有序样式清单: ${PLUGIN_RENDERER_STYLESHEET_MANIFEST_PATH}`);
  }
  const manifest = parsePluginRendererStylesheetManifest(readJsonFile(manifestPath));
  return manifest.stylesheets.map((stylesheetPath) => {
    const artifactPath = `dist/renderer/${stylesheetPath}`;
    const resolvedPath = resolveInsidePluginDir(pluginDir, artifactPath, 'renderer stylesheet');
    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
      throw new Error(`renderer stylesheet 产物不存在: ${artifactPath}`);
    }
    return `plugin://${pluginId}/${toPluginUrlPath(pluginDir, artifactPath, 'renderer stylesheet')}`;
  });
}

function toViteFsUrl(filePath: string): string {
  const absolutePath = path.resolve(filePath).replace(/\\/g, '/');
  return `/@fs/${absolutePath}`;
}

function readRendererUiRange(pluginId: string, range: string | undefined): string {
  if (!range) {
    throw new Error(`${pluginId} renderer 插件缺少 compat.rendererUi`);
  }
  if (!isValidRendererUiCompatibilityRange(range)) {
    throw new Error(`${pluginId} compat.rendererUi 不是有效的 node-semver range: ${range}`);
  }
  return range;
}

function readPackageJsonExportsRendererEntry(pluginDir: string, pluginId: string): string | null {
  const packageJsonPath = path.join(pluginDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) return null;

  const packageJson = readJsonFile(packageJsonPath);
  if (!packageJson || typeof packageJson !== 'object' || Array.isArray(packageJson)) {
    throw new Error(`${pluginId} package.json 必须是对象`);
  }

  const packageExports = (packageJson as Record<string, unknown>).exports;
  if (!packageExports || typeof packageExports !== 'object' || Array.isArray(packageExports)) {
    return null;
  }

  const rendererExport = (packageExports as Record<string, unknown>)['./renderer'];
  return typeof rendererExport === 'string' && rendererExport.trim().length > 0
    ? rendererExport
    : null;
}

function listOfficialSourceRendererPluginEntries(options: RendererPluginEntryListOptions): RendererPluginEntry[] {
  if (!options.preferSourceEntries) return [];

  const entries: RendererPluginEntry[] = [];
  const seen = new Set<string>();
  for (const pluginDir of options.officialPluginPackageDirs ?? []) {
    try {
      const manifest = readPluginManifestSummary(pluginDir);
      if (!manifest?.entry.renderer || !options.enabledIds.has(manifest.id)) {
        continue;
      }
      if (seen.has(manifest.id)) {
        options.reportDiagnostic?.({
          pluginId: manifest.id,
          message: 'renderer 源码态官方插件重复，已忽略后续实例',
        });
        continue;
      }

      const sourceRendererEntry = readPackageJsonExportsRendererEntry(pluginDir, manifest.id);
      if (!sourceRendererEntry) {
        continue;
      }

      const entryPath = resolveInsidePluginDir(pluginDir, sourceRendererEntry, 'package.exports["./renderer"]');
      if (!fs.existsSync(entryPath)) {
        options.reportDiagnostic?.({
          pluginId: manifest.id,
          message: `renderer 源码入口文件不存在: ${sourceRendererEntry}`,
        });
        continue;
      }

      seen.add(manifest.id);
      entries.push({
        pluginId: manifest.id,
        version: manifest.version,
        rendererUiRange: readRendererUiRange(manifest.id, manifest.compat?.rendererUi),
        entryUrl: toViteFsUrl(entryPath),
        cssUrls: [],
        sourceKind: 'official-source',
        pluginDir,
        entryPath,
      });
    } catch (error) {
      options.reportDiagnostic?.({
        pluginId: null,
        message: `读取官方 renderer 源码入口失败: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return entries;
}

function listDiskRendererPluginEntries(
  pluginDirs: readonly string[],
  options: RendererPluginEntryListOptions,
  sourceKind: 'direct' | 'active',
): RendererPluginEntry[] {
  const entries: RendererPluginEntry[] = [];
  const seen = new Set<string>();

  for (const pluginDir of pluginDirs) {
    try {
      const manifest = readPluginManifestSummary(pluginDir);
      if (!manifest?.entry.renderer || !options.enabledIds.has(manifest.id)) {
        continue;
      }

      if (seen.has(manifest.id)) {
        options.reportDiagnostic?.({
          pluginId: manifest.id,
          message: 'renderer 插件重复，已忽略后续实例',
        });
        continue;
      }

      const entryPath = resolveInsidePluginDir(pluginDir, manifest.entry.renderer, 'entry.renderer');
      if (!fs.existsSync(entryPath)) {
        options.reportDiagnostic?.({
          pluginId: manifest.id,
          message: `renderer 入口文件不存在: ${manifest.entry.renderer}`,
        });
        continue;
      }

      seen.add(manifest.id);
      entries.push({
        pluginId: manifest.id,
        version: manifest.version,
        rendererUiRange: readRendererUiRange(manifest.id, manifest.compat?.rendererUi),
        entryUrl: `plugin://${manifest.id}/${toPluginUrlPath(pluginDir, manifest.entry.renderer, 'entry.renderer')}`,
        cssUrls: listRendererCssUrls(pluginDir, manifest.id),
        sourceKind,
        pluginDir,
        entryPath,
      });
    } catch (error) {
      options.reportDiagnostic?.({
        pluginId: null,
        message: `读取 renderer 插件入口失败: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  return entries;
}

export function listRendererPluginEntriesFromLayout(options: RendererPluginEntryListOptions): RendererPluginEntry[] {
  const entries: RendererPluginEntry[] = [];
  const seen = new Set<string>();

  for (const directEntry of listDiskRendererPluginEntries(options.directPluginDirs ?? [], options, 'direct')) {
    seen.add(directEntry.pluginId);
    entries.push(directEntry);
  }

  // 中文说明：开发源码态下，官方插件源码入口必须优先于用户 active 安装目录。
  // 否则用户目录里的旧 artifact 会盖住本仓库刚修好的源码，表现为“源码已修但 dev 仍加载旧包”。
  for (const sourceEntry of listOfficialSourceRendererPluginEntries(options)) {
    if (seen.has(sourceEntry.pluginId)) {
      options.reportDiagnostic?.({
        pluginId: sourceEntry.pluginId,
        message: 'renderer 源码态官方插件已被 direct dir 覆盖',
      });
      continue;
    }
    seen.add(sourceEntry.pluginId);
    entries.push(sourceEntry);
  }

  for (const activeEntry of listDiskRendererPluginEntries(
    discoverActivePluginDirsFromLayout(options),
    options,
    'active',
  )) {
    if (seen.has(activeEntry.pluginId)) {
      options.reportDiagnostic?.({
        pluginId: activeEntry.pluginId,
        message: 'renderer 插件已由 direct dir 或官方源码入口提供，已忽略 active 安装目录实例',
      });
      continue;
    }
    seen.add(activeEntry.pluginId);
    entries.push(activeEntry);
  }

  return entries;
}
