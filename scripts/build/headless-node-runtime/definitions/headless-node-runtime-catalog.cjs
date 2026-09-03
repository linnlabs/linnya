const fs = require('node:fs');
const path = require('node:path');

const HEADLESS_NODE_RUNTIME_CATALOG_PATH = path.resolve(
  __dirname,
  '../../../../config/headless-node-runtime.json',
);

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRequiredString(record, key, label) {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} 缺少非空字符串 ${key}`);
  }
  return value;
}

function parseHeadlessNodeRuntimeCatalog(value) {
  if (!isRecord(value)) throw new Error('Headless Node runtime catalog 顶层必须是对象');
  if (
    value.schema_version !== 1
    || value.runtime_id !== 'linnya_headless_node_runtime'
    || typeof value.node_version !== 'string'
    || !/^\d+\.\d+\.\d+$/.test(value.node_version)
    || !Array.isArray(value.targets)
    || value.targets.length === 0
  ) {
    throw new Error('Headless Node runtime catalog 基础字段无效');
  }

  const identities = new Set();
  const targets = value.targets.map((candidate) => {
    if (!isRecord(candidate)) throw new Error('Headless Node runtime target 必须是对象');
    const platform = readRequiredString(candidate, 'platform', 'Headless Node runtime target');
    const architecture = readRequiredString(
      candidate,
      'architecture',
      'Headless Node runtime target',
    );
    const archiveKind = readRequiredString(
      candidate,
      'archive_kind',
      'Headless Node runtime target',
    );
    const archiveFileName = readRequiredString(
      candidate,
      'archive_file_name',
      'Headless Node runtime target',
    );
    const archiveSha256 = readRequiredString(
      candidate,
      'archive_sha256',
      'Headless Node runtime target',
    );
    const archiveRoot = readRequiredString(
      candidate,
      'archive_root',
      'Headless Node runtime target',
    );
    const executableRelativePath = readRequiredString(
      candidate,
      'executable_relative_path',
      'Headless Node runtime target',
    );
    if (
      (platform !== 'darwin' && platform !== 'win32')
      || (architecture !== 'arm64' && architecture !== 'x64')
      || (archiveKind !== 'tar.gz' && archiveKind !== 'zip')
      || !/^[a-f0-9]{64}$/.test(archiveSha256)
      || path.isAbsolute(executableRelativePath)
      || executableRelativePath.split(/[\\/]/).includes('..')
    ) {
      throw new Error(`Headless Node runtime target 无效：${platform}/${architecture}`);
    }
    const identity = `${platform}/${architecture}`;
    if (identities.has(identity)) {
      throw new Error(`Headless Node runtime target 重复：${identity}`);
    }
    identities.add(identity);
    return Object.freeze({
      platform,
      architecture,
      archiveKind,
      archiveFileName,
      archiveSha256,
      archiveRoot,
      executableRelativePath,
    });
  });

  return Object.freeze({
    schemaVersion: 1,
    runtimeId: value.runtime_id,
    nodeVersion: value.node_version,
    targets: Object.freeze(targets),
  });
}

function readHeadlessNodeRuntimeCatalog() {
  return parseHeadlessNodeRuntimeCatalog(
    JSON.parse(fs.readFileSync(HEADLESS_NODE_RUNTIME_CATALOG_PATH, 'utf8')),
  );
}

function resolveHeadlessNodeRuntimeTarget(catalog, platform, architecture) {
  const target = catalog.targets.find(candidate => (
    candidate.platform === platform && candidate.architecture === architecture
  ));
  if (!target) {
    throw new Error(`不支持 Headless Node runtime 目标：${platform}/${architecture}`);
  }
  return target;
}

module.exports = {
  HEADLESS_NODE_RUNTIME_CATALOG_PATH,
  parseHeadlessNodeRuntimeCatalog,
  readHeadlessNodeRuntimeCatalog,
  resolveHeadlessNodeRuntimeTarget,
};
