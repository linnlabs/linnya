import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { PluginCatalogRevocation } from '@app/schemas';

import type { TrustedPluginCatalogKeys } from '../../plugins/catalog/definitions/pluginCatalog';
import type { ResolvedPluginRuntime } from '../../plugins/catalog/functions/selectCatalogPluginRelease';
import type { ArtifactTransferControl, CatalogInstallProvenance } from '../../plugins/install/definitions/pluginInstall';
import { PluginOperationError } from '../../plugins/install/definitions/pluginOperationError';
import { assertAvailableDiskSpace } from '../../plugins/install/infrastructure/assertAvailableDiskSpace';
import { downloadVerifiedArtifact } from '../../plugins/install/infrastructure/downloadVerifiedArtifact';
import { extractZipToDirectory } from '../../plugins/install/infrastructure/extractZipArchive';
import { createInstallStagingPath, removeAbandonedInstallStaging } from '../../plugins/install/infrastructure/installStagingDirectory';
import { resolveInstalledRuntimeExecutable } from '../functions/resolveInstalledRuntimeExecutable';
import {
  readActiveRuntimeVersion,
  readRuntimeComponentReceipt,
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
/**
 * 同版本目录的现状：可执行文件与本次 catalog 一致则复用；缺失，或被改动但目录自己的回执与本次是同一份发布，
 * 视为损坏（例如被删除或被安全软件隔离），用校验过的新下载替换；回执显示是另一份发布则拒绝覆盖。
 * 能走到这里说明组件已复核失败，没有进程在从该目录运行。
 */
function inspectExistingVersionDirectory(
  runtimeRoot: string,
  runtime: ResolvedPluginRuntime,
  versionDirectory: string,
): 'absent' | 'reusable' | 'damaged' | 'conflict' {
  if (!fs.existsSync(versionDirectory)) return 'absent';
  const executable = executableInside(versionDirectory, runtime.target.executable);
  if (!fs.statSync(executable, { throwIfNoEntry: false })?.isFile()) return 'damaged';
  if (sha256File(executable) === runtime.target.executableSha256) return 'reusable';
  const receipt = readRuntimeComponentReceipt(runtimeRoot, runtime.id, runtime.version);
  return receipt?.executableSha256 === runtime.target.executableSha256 && receipt.artifactSha512 === runtime.target.sha512
    ? 'damaged'
    : 'conflict';
}

/** 先把损坏目录移到临时目录里，再换上新目录；换上失败时原样移回。 */
function replaceDamagedVersionDirectory(versionDirectory: string, extractDirectory: string, tempDirectory: string): void {
  const damaged = path.join(tempDirectory, 'damaged');
  fs.renameSync(versionDirectory, damaged);
  try {
    fs.renameSync(extractDirectory, versionDirectory);
  } catch (error) {
    fs.renameSync(damaged, versionDirectory);
    throw error;
  }
}

function pruneRuntimeVersions(runtimeRoot: string, runtimeId: string, keep: readonly string[]): void {
  const directory = runtimeComponentDirectory(runtimeRoot, runtimeId);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || keep.includes(entry.name)) continue;
    fs.rmSync(path.join(directory, entry.name), { recursive: true, force: true });
    fs.rmSync(path.join(directory, '.receipts', `${entry.name}.json`), { force: true });
  }
}

/** 已激活版本与目标一致且回执、可执行文件摘要都通过校验时视为已安装，不需要下载。 */
export async function isRuntimeComponentCurrent(input: {
  readonly runtimeRoot: string;
  readonly runtime: ResolvedPluginRuntime;
  readonly trustedKeys: TrustedPluginCatalogKeys;
  readonly laterRevocations?: readonly PluginCatalogRevocation[];
}): Promise<boolean> {
  const { runtime } = input;
  if (readActiveRuntimeVersion(input.runtimeRoot, runtime.id) !== runtime.version) return false;
  const current = await resolveInstalledRuntimeExecutable({
    runtimeRoot: input.runtimeRoot,
    runtimeId: runtime.id,
    platform: runtime.target.platform,
    architecture: runtime.target.architecture,
    trustedKeys: input.trustedKeys,
    laterRevocations: input.laterRevocations,
  });
  return current.status === 'resolved';
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
  readonly control?: ArtifactTransferControl;
}): Promise<RuntimeComponentInstallResult> {
  const { runtime } = input;
  const { target } = runtime;
  const control = input.control ?? {};
  const previousVersion = readActiveRuntimeVersion(input.runtimeRoot, runtime.id);
  if (await isRuntimeComponentCurrent(input)) {
    return { status: 'current', runtimeId: runtime.id, version: runtime.version };
  }

  const runtimeDirectory = runtimeComponentDirectory(input.runtimeRoot, runtime.id);
  const versionDirectory = runtimeComponentVersionDirectory(input.runtimeRoot, runtime.id, runtime.version);
  fs.mkdirSync(runtimeDirectory, { recursive: true });
  removeAbandonedInstallStaging(runtimeDirectory);
  const tempDirectory = createInstallStagingPath(runtimeDirectory, runtime.version);
  try {
    const existing = inspectExistingVersionDirectory(input.runtimeRoot, runtime, versionDirectory);
    if (existing === 'conflict') {
      throw new PluginOperationError('version-conflict', `运行时版本目录已存在但内容不一致: ${runtime.id}@${runtime.version}`);
    }
    if (existing === 'reusable') {
      // 不可变版本目录可能来自中断前的安装：可执行文件字节一致才复用。
      control.onInstalling?.();
    } else {
      await assertAvailableDiskSpace([{ directory: runtimeDirectory, bytes: target.size + target.unpackedSize }]);
      const extractDirectory = path.join(tempDirectory, 'extract');
      fs.mkdirSync(extractDirectory, { recursive: true });
      const zipPath = path.join(tempDirectory, 'artifact.zip');
      await downloadVerifiedArtifact({
        fetch: input.fetch,
        url: target.artifactUrl,
        destinationPath: zipPath,
        label: '运行时组件',
        expectedSha512: target.sha512,
        expectedSize: target.size,
        signal: control.signal,
        onProgress: control.onProgress,
      });
      control.onInstalling?.();
      await extractZipToDirectory(zipPath, extractDirectory, { maxUnpackedBytes: target.unpackedSize });
      const executable = executableInside(extractDirectory, target.executable);
      if (!fs.statSync(executable, { throwIfNoEntry: false })?.isFile()) {
        throw new PluginOperationError('artifact-integrity', `运行时组件缺少可执行文件: ${target.executable}`);
      }
      if (sha256File(executable) !== target.executableSha256) {
        throw new PluginOperationError('artifact-integrity', '运行时可执行文件 SHA-256 与 catalog 不一致');
      }
      if (target.platform !== 'win32') fs.chmodSync(executable, 0o755);
      if (existing === 'damaged') replaceDamagedVersionDirectory(versionDirectory, extractDirectory, tempDirectory);
      else fs.renameSync(extractDirectory, versionDirectory);
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
