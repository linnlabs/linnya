import path from 'node:path';

import type {
  HeadlessNodeRuntimeCatalog,
  HeadlessNodeRuntimeTarget,
} from '../definitions/headlessNodeRuntime';

export function parseHeadlessNodeRuntimeCatalog(
  value: unknown,
): HeadlessNodeRuntimeCatalog {
  if (!isRecord(value)
    || value.schema_version !== 1
    || value.runtime_id !== 'linnya_headless_node_runtime'
    || typeof value.node_version !== 'string'
    || !/^\d+\.\d+\.\d+$/.test(value.node_version)
    || !Array.isArray(value.targets)
    || value.targets.length === 0) {
    throw new Error('Headless Node runtime catalog 无效');
  }
  const targets = value.targets.map(parseTarget);
  const identities = new Set<string>();
  for (const target of targets) {
    const identity = `${target.platform}/${target.architecture}`;
    if (identities.has(identity)) {
      throw new Error(`Headless Node runtime target 重复：${identity}`);
    }
    identities.add(identity);
  }
  return Object.freeze({
    schemaVersion: 1,
    runtimeId: 'linnya_headless_node_runtime',
    nodeVersion: value.node_version,
    targets: Object.freeze(targets),
  });
}

function parseTarget(value: unknown): HeadlessNodeRuntimeTarget {
  if (!isRecord(value)) throw new Error('Headless Node runtime target 无效');
  const platform = value.platform;
  const architecture = value.architecture;
  const archiveFileName = value.archive_file_name;
  const archiveSha256 = value.archive_sha256;
  const executableRelativePath = value.executable_relative_path;
  if ((platform !== 'darwin' && platform !== 'win32')
    || (architecture !== 'arm64' && architecture !== 'x64')
    || typeof archiveFileName !== 'string'
    || archiveFileName.length === 0
    || typeof archiveSha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(archiveSha256)
    || typeof executableRelativePath !== 'string'
    || executableRelativePath.length === 0
    || path.isAbsolute(executableRelativePath)
    || executableRelativePath.split(/[\\/]/).includes('..')) {
    throw new Error('Headless Node runtime target 字段无效');
  }
  return Object.freeze({
    platform,
    architecture,
    archiveFileName,
    archiveSha256,
    executableRelativePath,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
