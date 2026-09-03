import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import type {
  HeadlessNodeRuntimeCatalog,
  HeadlessNodeRuntimeTarget,
  ResolvedHeadlessNodeRuntime,
} from '../definitions/headlessNodeRuntime';

const RUNTIME_MANIFEST_FILE_NAME = 'runtime-manifest.json';

/**
 * 解析已经由构建链准备并校验来源的固定 Node distribution。消费者自己拥有 entry；
 * 这里不接受 PATH、process.execPath 或 Electron executable 作为 fallback。
 */
export async function resolveHeadlessNodeRuntime(input: {
  readonly catalog: HeadlessNodeRuntimeCatalog;
  readonly runtimeDirectory: string;
  readonly platform: NodeJS.Platform;
  readonly architecture: string;
  /** 正式包的可执行文件经过签名，bytes 会变化；其完整性由 afterSign/平台签名门禁负责。 */
  readonly verifyPreparedExecutableHash: boolean;
}): Promise<ResolvedHeadlessNodeRuntime> {
  if (!path.isAbsolute(input.runtimeDirectory)) {
    throw new Error('Headless Node runtime directory 必须是绝对路径');
  }
  const target = input.catalog.targets.find(candidate => (
    candidate.platform === input.platform
    && candidate.architecture === input.architecture
  ));
  if (!target) {
    throw new Error(
      `Headless Node runtime 不支持 ${input.platform}/${input.architecture}`,
    );
  }
  const manifestPath = path.join(input.runtimeDirectory, RUNTIME_MANIFEST_FILE_NAME);
  const manifest = parseRuntimeManifest(
    JSON.parse(await readFile(manifestPath, 'utf8')),
  );
  assertRuntimeManifestMatches({
    manifest,
    catalog: input.catalog,
    target,
  });
  const executablePath = path.join(
    input.runtimeDirectory,
    target.executableRelativePath,
  );
  const [executableStat, licenseStat] = await Promise.all([
    stat(executablePath),
    stat(path.join(input.runtimeDirectory, 'LICENSE')),
  ]);
  if (!executableStat.isFile() || executableStat.size <= 0) {
    throw new Error('Headless Node runtime executable 不是非空普通文件');
  }
  if (!licenseStat.isFile() || licenseStat.size <= 0) {
    throw new Error('Headless Node runtime 缺少 LICENSE');
  }
  if (target.platform === 'darwin' && (executableStat.mode & 0o111) === 0) {
    throw new Error('Headless Node runtime executable 缺少执行权限');
  }
  if (executableStat.size !== manifest.preparedExecutableSizeBytes) {
    throw new Error('Headless Node runtime executable size 与 manifest 不一致');
  }
  if (input.verifyPreparedExecutableHash) {
    const executableSha256 = createHash('sha256')
      .update(await readFile(executablePath))
      .digest('hex');
    if (executableSha256 !== manifest.preparedExecutableSha256) {
      throw new Error('Headless Node runtime 开发产物 hash 不匹配');
    }
  }
  return Object.freeze({
    nodeVersion: input.catalog.nodeVersion,
    manifestPath,
    executablePath,
  });
}

interface HeadlessNodeRuntimeManifest {
  readonly schemaVersion: number;
  readonly runtimeId: string;
  readonly nodeVersion: string;
  readonly platform: string;
  readonly architecture: string;
  readonly archiveFileName: string;
  readonly archiveSha256: string;
  readonly executableRelativePath: string;
  readonly preparedExecutableSizeBytes: number;
  readonly preparedExecutableSha256: string;
}

function parseRuntimeManifest(value: unknown): HeadlessNodeRuntimeManifest {
  if (!isRecord(value)
    || !isRecord(value.distribution)
    || !isRecord(value.prepared_executable)) {
    throw new Error('Headless Node runtime manifest 无效');
  }
  return Object.freeze({
    schemaVersion: requireNumber(value.schema_version, 'schema_version'),
    runtimeId: requireString(value.runtime_id, 'runtime_id'),
    nodeVersion: requireString(value.node_version, 'node_version'),
    platform: requireString(value.platform, 'platform'),
    architecture: requireString(value.architecture, 'architecture'),
    archiveFileName: requireString(
      value.distribution.archive_file_name,
      'distribution.archive_file_name',
    ),
    archiveSha256: requireSha256(
      value.distribution.archive_sha256,
      'distribution.archive_sha256',
    ),
    executableRelativePath: requireString(
      value.prepared_executable.relative_path,
      'prepared_executable.relative_path',
    ),
    preparedExecutableSizeBytes: requirePositiveNumber(
      value.prepared_executable.size_bytes,
      'prepared_executable.size_bytes',
    ),
    preparedExecutableSha256: requireSha256(
      value.prepared_executable.sha256,
      'prepared_executable.sha256',
    ),
  });
}

function assertRuntimeManifestMatches(input: {
  readonly manifest: HeadlessNodeRuntimeManifest;
  readonly catalog: HeadlessNodeRuntimeCatalog;
  readonly target: HeadlessNodeRuntimeTarget;
}): void {
  if (input.manifest.schemaVersion !== input.catalog.schemaVersion
    || input.manifest.runtimeId !== input.catalog.runtimeId
    || input.manifest.nodeVersion !== input.catalog.nodeVersion
    || input.manifest.platform !== input.target.platform
    || input.manifest.architecture !== input.target.architecture
    || input.manifest.archiveFileName !== input.target.archiveFileName
    || input.manifest.archiveSha256 !== input.target.archiveSha256
    || normalizeRelativePath(input.manifest.executableRelativePath)
      !== normalizeRelativePath(input.target.executableRelativePath)) {
    throw new Error('Headless Node runtime manifest 与冻结 catalog 不一致');
  }
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Headless Node runtime ${label} 无效`);
  }
  return value;
}

function requireSha256(value: unknown, label: string): string {
  const parsed = requireString(value, label);
  if (!/^[a-f0-9]{64}$/.test(parsed)) {
    throw new Error(`Headless Node runtime ${label} 无效`);
  }
  return parsed;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`Headless Node runtime ${label} 无效`);
  }
  return value;
}

function requirePositiveNumber(value: unknown, label: string): number {
  const parsed = requireNumber(value, label);
  if (parsed <= 0) throw new Error(`Headless Node runtime ${label} 无效`);
  return parsed;
}
