import fs from 'node:fs';
import path from 'node:path';

export interface PluginLayoutDiagnostic {
  readonly pluginId: string | null;
  readonly message: string;
}

export type PluginLayoutDiagnosticReporter = (diagnostic: PluginLayoutDiagnostic) => void;

export interface PluginManifestEntrySummary {
  readonly backend?: string;
  readonly renderer?: string;
  readonly [key: string]: string | undefined;
}

export interface PluginManifestSummary {
  readonly id: string;
  readonly version: string;
  readonly required?: boolean;
  readonly entry: PluginManifestEntrySummary;
  readonly compat?: {
    readonly rendererUi?: string;
  };
}

export interface PluginLayoutOptions {
  readonly pluginRoot?: string;
  readonly directPluginDirs?: readonly string[];
  readonly reportDiagnostic?: PluginLayoutDiagnosticReporter;
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

function readStringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readEntrySummary(value: unknown): PluginManifestEntrySummary {
  if (!isRecord(value)) {
    throw new Error('plugin.json entry 必须是对象');
  }

  const entry: Record<string, string> = {};
  for (const [key, rawEntryPath] of Object.entries(value)) {
    if (typeof rawEntryPath === 'string' && rawEntryPath.trim().length > 0) {
      entry[key] = rawEntryPath;
    }
  }

  if (Object.keys(entry).length === 0) {
    throw new Error('plugin.json entry 必须声明至少一个入口');
  }

  return entry;
}

function parseManifestSummary(input: unknown): PluginManifestSummary {
  if (!isRecord(input)) {
    throw new Error('plugin.json 必须是对象');
  }

  const id = readStringField(input, 'id');
  const version = readStringField(input, 'version');
  if (!id || !version) {
    throw new Error('plugin.json 必须声明非空 id/version');
  }

  const compat = input.compat;
  if (compat !== undefined && !isRecord(compat)) {
    throw new Error('plugin.json compat 必须是对象');
  }
  const rendererUi = compat ? readStringField(compat, 'rendererUi') : null;
  if (compat && compat.rendererUi !== undefined && !rendererUi) {
    throw new Error('plugin.json compat.rendererUi 必须是非空字符串');
  }

  return {
    id,
    version,
    ...(input.required === true ? { required: true } : {}),
    entry: readEntrySummary(input.entry),
    ...(rendererUi ? { compat: { rendererUi } } : {}),
  };
}

function parseActivePointer(input: unknown): ActivePluginPointer {
  if (!isRecord(input) || typeof input.version !== 'string' || input.version.trim().length === 0) {
    throw new Error('active.json 必须声明非空 version');
  }
  return { version: input.version };
}

function report(
  reporter: PluginLayoutDiagnosticReporter | undefined,
  pluginId: string | null,
  message: string,
): void {
  reporter?.({ pluginId, message });
}

export function readJsonFile(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function readDirectPluginDirsFromEnv(raw: string | undefined = process.env.LINNYA_PLUGIN_DIRECT_DIRS): string[] {
  if (!raw) return [];
  return raw.split(path.delimiter).map((entry) => entry.trim()).filter(Boolean);
}

/**
 * Backend 源码仓只通过已构建的插件入口接入 Host；这个目录集合不影响 renderer
 * 的 direct artifact 优先级，因此外置插件仍可在开发态使用源码入口和 Vite HMR。
 */
export function readBackendDirectPluginDirsFromEnv(
  raw: string | undefined = process.env.LINNYA_PLUGIN_BACKEND_DIRECT_DIRS,
): string[] {
  if (!raw) return [];
  return raw.split(path.delimiter).map((entry) => entry.trim()).filter(Boolean);
}

/**
 * 开发态只发现 monorepo 中具有 plugin.json 的插件包。
 *
 * 这里不维护插件 ID 清单；具体插件是否有 CLI、是否进入产品运行面，继续由 manifest
 * 和后续 registry 决定。发布态不调用该函数，只读取 active artifact 布局。
 */
export function discoverDevelopmentPluginDirs(pluginsRoot: string): string[] {
  if (!path.isAbsolute(pluginsRoot)) {
    throw new Error('开发插件根目录必须是绝对路径');
  }
  if (!fs.existsSync(pluginsRoot)) {
    return [];
  }
  return fs.readdirSync(pluginsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(pluginsRoot, entry.name))
    .filter(pluginDir => fs.existsSync(path.join(pluginDir, 'plugin.json')));
}

export function resolveInsidePluginDir(baseDir: string, relativePath: string, label: string): string {
  const resolved = path.resolve(baseDir, relativePath);
  const relative = path.relative(baseDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} 不能指向插件目录外: ${relativePath}`);
  }
  return resolved;
}

export function readPluginManifestSummary(pluginDir: string): PluginManifestSummary | null {
  const manifestPath = path.join(pluginDir, 'plugin.json');
  if (!fs.existsSync(manifestPath)) return null;
  return parseManifestSummary(readJsonFile(manifestPath));
}

function discoverActivePluginDirs(options: PluginLayoutOptions): string[] {
  const pluginRoot = options.pluginRoot;
  if (!pluginRoot || !fs.existsSync(pluginRoot)) {
    return [];
  }

  return fs.readdirSync(pluginRoot, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) return [];
    const pluginDir = path.join(pluginRoot, entry.name);
    const activePath = path.join(pluginDir, 'active.json');
    if (!fs.existsSync(activePath)) return [];

    try {
      const active = parseActivePointer(readJsonFile(activePath));
      return [resolveInsidePluginDir(pluginDir, active.version, 'active.version')];
    } catch (error) {
      report(options.reportDiagnostic, entry.name, `读取插件 active.json 失败: ${readErrorMessage(error)}`);
      return [];
    }
  });
}

export function discoverActivePluginDirsFromLayout(options: PluginLayoutOptions): string[] {
  return discoverActivePluginDirs(options);
}

export function discoverPluginDirsFromLayout(options: PluginLayoutOptions): string[] {
  // 中文说明：direct dirs 是开发/调试入口，放在 active 布局之前，方便本地构建产物覆盖已安装版本。
  return [
    ...(options.directPluginDirs ?? []),
    ...discoverActivePluginDirs(options),
  ];
}

export function resolvePluginDirById(options: PluginLayoutOptions & { readonly pluginId: string }): string | null {
  for (const pluginDir of discoverPluginDirsFromLayout(options)) {
    try {
      const manifest = readPluginManifestSummary(pluginDir);
      if (manifest?.id === options.pluginId) {
        return pluginDir;
      }
    } catch (error) {
      report(options.reportDiagnostic, null, `读取插件 manifest 失败: ${readErrorMessage(error)}`);
    }
  }

  return null;
}

export function resolvePluginEntryById(options: PluginLayoutOptions & {
  readonly pluginId: string;
  readonly entryName: string;
}): string | null {
  const pluginDir = resolvePluginDirById(options);
  if (!pluginDir) return null;

  try {
    const manifest = readPluginManifestSummary(pluginDir);
    const entryPath = manifest?.entry[options.entryName];
    if (!entryPath) return null;
    const resolved = resolveInsidePluginDir(pluginDir, entryPath, `entry.${options.entryName}`);
    return fs.existsSync(resolved) && fs.statSync(resolved).isFile() ? resolved : null;
  } catch (error) {
    report(
      options.reportDiagnostic,
      options.pluginId,
      `读取插件入口 ${options.entryName} 失败: ${readErrorMessage(error)}`,
    );
    return null;
  }
}
