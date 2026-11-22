import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { PluginCatalogRevocation } from '@app/schemas';

import type { TrustedPluginCatalogKeys } from '../../plugins/catalog/definitions/pluginCatalog';
import type { ResolvedPluginRuntime } from '../../plugins/catalog/functions/selectCatalogPluginRelease';
import type { CatalogInstallProvenance } from '../../plugins/install/definitions/pluginInstall';
import { PluginOperationError } from '../../plugins/install/definitions/pluginOperationError';
import { extractZipToDirectory } from '../../plugins/install/orchestration/installPluginUpdate';
import { resolveInstalledRuntimeExecutable } from '../functions/resolveInstalledRuntimeExecutable';
import {
  readActiveRuntimeVersion,
  runtimeComponentDirectory,
  runtimeComponentVersionDirectory,
  writeActiveRuntimeVersion,
  writeRuntimeComponentReceipt,
} from '../infrastructure/runtimeComponentStore';

export type RuntimeComponentInstallResult =
  | { readonly status: 'current'; readonly runtimeId: string; readonly version: string }
  | { readonly status: 'installed'; readonly runtimeId: string; readonly version: string; readonly previousVersion: string | null };

function sha256File(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function executableInside(versionDirectory: string, relativeExecutable: string): string {
  const executable = path.resolve(versionDirectory, ...relativeExecutable.split(/[\\/]/u));
  const relative = path.relative(versionDirectory, executable);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new PluginOperationError('artifact-integrity', `运行时可执行文件路径越界: ${relativeExecutable}`);
  }
  return executable;
}

/** 只保留当前与上一版，避免每次升级都累积几十 MB 的旧运行时。 */
function pruneRuntimeVersions(runtimeRoot: string, runtimeId: string, keep: readonly string[]): void {
  const directory = runtimeComponentDirectory(runtimeRoot, runtimeId);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || keep.includes(entry.name)) continue;
    fs.rmSync(path.join(directory, entry.name), { recursive: true, force: true });
    fs.rmSync(path.join(directory, '.receipts', `${entry.name}.json`), { force: true });
  }
}

/**
 * 按已验签 catalog 安装插件所需的原生运行时：下载 → sha512 → 解压 → 可执行文件 SHA-256 →
 * 写回执 → 切换 active 指针。任一步失败都不改变现有 active 版本。
 */
export async function installRuntimeComponent(input: {
  readonly runtimeRoot: string;
  readonly runtime: ResolvedPluginRuntime;
  readonly provenance: CatalogInstallProvenance;
  readonly trustedKeys: TrustedPluginCatalogKeys;
  readonly laterRevocations?: readonly PluginCatalogRevocation[];
  readonly fetch: typeof fetch;
}): Promise<RuntimeComponentInstallResult> {
  const { runtime } = input;
  const { target } = runtime;
  const previousVersion = readActiveRuntimeVersion(input.runtimeRoot, runtime.id);
  if (previousVersion === runtime.version) {
    const current = await resolveInstalledRuntimeExecutable({
      runtimeRoot: input.runtimeRoot,
      runtimeId: runtime.id,
      platform: target.platform,
      architecture: target.architecture,
      trustedKeys: input.trustedKeys,
      laterRevocations: input.laterRevocations,
    });
    if (current.status === 'resolved') return { status: 'current', runtimeId: runtime.id, version: runtime.version };
  }

  const runtimeDirectory = runtimeComponentDirectory(input.runtimeRoot, runtime.id);
  const versionDirectory = runtimeComponentVersionDirectory(input.runtimeRoot, runtime.id, runtime.version);
  fs.mkdirSync(runtimeDirectory, { recursive: true });
  const tempDirectory = path.join(runtimeDirectory, `.install-${runtime.version}.${process.pid}.${Date.now()}`);
  try {
    if (fs.existsSync(versionDirectory)) {
      // 不可变版本目录可能来自中断前的安装：字节一致才复用，否则拒绝覆盖。
      if (sha256File(executableInside(versionDirectory, target.executable)) !== target.executableSha256) {
        throw new PluginOperationError('version-conflict', `运行时版本目录已存在但内容不一致: ${runtime.id}@${runtime.version}`);
      }
    } else {
      const response = await input.fetch(target.artifactUrl, { redirect: 'error' });
      if (!response.ok) {
        throw new PluginOperationError('source-unavailable', `下载运行时组件失败: ${response.status} ${response.statusText}`);
      }
      const zip = Buffer.from(await response.arrayBuffer());
      if (zip.byteLength !== target.size) {
        throw new PluginOperationError('artifact-integrity', `运行时组件大小与 catalog 不一致: expected=${target.size} actual=${zip.byteLength}`);
      }
      const actualSha512 = createHash('sha512').update(zip).digest('hex');
      if (actualSha512 !== target.sha512) {
        throw new PluginOperationError('artifact-integrity', `运行时组件 sha512 不匹配: expected=${target.sha512} actual=${actualSha512}`);
      }
      const extractDirectory = path.join(tempDirectory, 'extract');
      fs.mkdirSync(extractDirectory, { recursive: true });
      const zipPath = path.join(tempDirectory, 'artifact.zip');
      fs.writeFileSync(zipPath, zip);
      await extractZipToDirectory(zipPath, extractDirectory);
      const executable = executableInside(extractDirectory, target.executable);
      if (!fs.statSync(executable, { throwIfNoEntry: false })?.isFile()) {
        throw new PluginOperationError('artifact-integrity', `运行时组件缺少可执行文件: ${target.executable}`);
      }
      if (sha256File(executable) !== target.executableSha256) {
        throw new PluginOperationError('artifact-integrity', '运行时可执行文件 SHA-256 与 catalog 不一致');
      }
      if (target.platform !== 'win32') fs.chmodSync(executable, 0o755);
      fs.renameSync(extractDirectory, versionDirectory);
    }
    writeRuntimeComponentReceipt(input.runtimeRoot, {
      schemaVersion: 1,
      source: 'catalog-official',
      runtimeId: runtime.id,
      version: runtime.version,
      platform: target.platform,
      architecture: target.architecture,
      artifactSha512: target.sha512,
      executable: target.executable,
      executableSha256: target.executableSha256,
      installedAt: new Date().toISOString(),
      catalog: { ...input.provenance },
    });
    writeActiveRuntimeVersion(input.runtimeRoot, runtime.id, runtime.version);
    pruneRuntimeVersions(input.runtimeRoot, runtime.id, [runtime.version, ...(previousVersion ? [previousVersion] : [])]);
    return { status: 'installed', runtimeId: runtime.id, version: runtime.version, previousVersion };
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}
