const fs = require('node:fs');
const path = require('node:path');

const QDRANT_RUNTIME_CATALOG_PATH = path.resolve(
  __dirname,
  '../../../../config/qdrant-runtime.json'
);

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RELEASE_COMMIT_PATTERN = /^[a-f0-9]{40}$/;

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

function readSha256(record, key, label) {
  const value = readRequiredString(record, key, label);
  if (!SHA256_PATTERN.test(value)) {
    throw new Error(`${label} 的 ${key} 不是 SHA-256`);
  }
  return value;
}

function readPositiveInteger(record, key, label) {
  const value = record[key];
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} 的 ${key} 必须是正整数`);
  }
  return value;
}

function assertSafeRelativePath(value, label) {
  if (path.isAbsolute(value) || value.split(/[\\/]/).includes('..')) {
    throw new Error(`${label} 必须是安全的相对路径`);
  }
}

function assertSinglePathSegment(value, label) {
  assertSafeRelativePath(value, label);
  if (path.basename(value) !== value) throw new Error(`${label} 不能包含目录`);
}

function parseUpstream(value, version) {
  if (!isRecord(value)) throw new Error('Qdrant runtime catalog 缺少 upstream');
  const repositoryUrl = readRequiredString(value, 'repository_url', 'Qdrant upstream');
  const releaseTag = readRequiredString(value, 'release_tag', 'Qdrant upstream');
  const releaseCommit = readRequiredString(value, 'release_commit', 'Qdrant upstream');
  const licenseSpdx = readRequiredString(value, 'license_spdx', 'Qdrant upstream');
  const licenseUrl = readRequiredString(value, 'license_url', 'Qdrant upstream');
  const licenseSha256 = readSha256(value, 'license_sha256', 'Qdrant upstream');

  if (
    repositoryUrl !== 'https://github.com/qdrant/qdrant' ||
    releaseTag !== `v${version}` ||
    !RELEASE_COMMIT_PATTERN.test(releaseCommit) ||
    licenseSpdx !== 'Apache-2.0' ||
    licenseUrl !== `https://raw.githubusercontent.com/qdrant/qdrant/${releaseTag}/LICENSE`
  ) {
    throw new Error('Qdrant upstream 必须锁定官方仓库、精确 tag、commit 与 Apache-2.0 文本');
  }

  return Object.freeze({
    repositoryUrl,
    releaseTag,
    releaseCommit,
    licenseSpdx,
    licenseUrl,
    licenseSha256,
  });
}

function parseTarget(candidate, version) {
  if (!isRecord(candidate)) throw new Error('Qdrant runtime target 必须是对象');
  const label = 'Qdrant runtime target';
  const platform = readRequiredString(candidate, 'platform', label);
  const architecture = readRequiredString(candidate, 'architecture', label);
  const outputDirectory = readRequiredString(candidate, 'output_directory', label);
  const archiveKind = readRequiredString(candidate, 'archive_kind', label);
  const archiveFileName = readRequiredString(candidate, 'archive_file_name', label);
  const archiveUrl = readRequiredString(candidate, 'archive_url', label);
  const archiveSha256 = readSha256(candidate, 'archive_sha256', label);
  const archiveEntry = readRequiredString(candidate, 'archive_entry', label);
  const executableFileName = readRequiredString(candidate, 'executable_file_name', label);
  const executableSizeBytes = readPositiveInteger(candidate, 'executable_size_bytes', label);
  const executableSha256 = readSha256(candidate, 'executable_sha256', label);

  if (
    (platform !== 'darwin' && platform !== 'win32') ||
    (architecture !== 'arm64' && architecture !== 'x64') ||
    (archiveKind !== 'tar.gz' && archiveKind !== 'zip') ||
    !archiveUrl.startsWith(`https://github.com/qdrant/qdrant/releases/download/v${version}/`) ||
    !archiveUrl.endsWith(`/${archiveFileName}`)
  ) {
    throw new Error(`Qdrant runtime target 无效：${platform}/${architecture}`);
  }
  assertSinglePathSegment(outputDirectory, `${label} output_directory`);
  assertSinglePathSegment(archiveFileName, `${label} archive_file_name`);
  assertSafeRelativePath(archiveEntry, `${label} archive_entry`);
  assertSinglePathSegment(executableFileName, `${label} executable_file_name`);

  return Object.freeze({
    platform,
    architecture,
    outputDirectory,
    archiveKind,
    archiveFileName,
    archiveUrl,
    archiveSha256,
    archiveEntry,
    executableFileName,
    executableSizeBytes,
    executableSha256,
  });
}

function parseQdrantRuntimeCatalog(value) {
  if (!isRecord(value)) throw new Error('Qdrant runtime catalog 顶层必须是对象');
  if (
    value.schema_version !== 1 ||
    value.runtime_id !== 'linnya_qdrant_runtime' ||
    typeof value.version !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(value.version) ||
    !Array.isArray(value.targets) ||
    value.targets.length === 0
  ) {
    throw new Error('Qdrant runtime catalog 基础字段无效');
  }

  const upstream = parseUpstream(value.upstream, value.version);
  const identities = new Set();
  const outputDirectories = new Set();
  const targets = value.targets.map(candidate => {
    const target = parseTarget(candidate, value.version);
    const identity = `${target.platform}/${target.architecture}`;
    if (identities.has(identity)) throw new Error(`Qdrant runtime target 重复：${identity}`);
    if (outputDirectories.has(target.outputDirectory)) {
      throw new Error(`Qdrant runtime output_directory 重复：${target.outputDirectory}`);
    }
    identities.add(identity);
    outputDirectories.add(target.outputDirectory);
    return target;
  });

  return Object.freeze({
    schemaVersion: 1,
    runtimeId: value.runtime_id,
    version: value.version,
    upstream,
    targets: Object.freeze(targets),
  });
}

function readQdrantRuntimeCatalog() {
  return parseQdrantRuntimeCatalog(
    JSON.parse(fs.readFileSync(QDRANT_RUNTIME_CATALOG_PATH, 'utf8'))
  );
}

function resolveQdrantRuntimeTarget(catalog, platform, architecture) {
  const target = catalog.targets.find(
    candidate => candidate.platform === platform && candidate.architecture === architecture
  );
  if (!target) throw new Error(`不支持 Qdrant runtime 目标：${platform}/${architecture}`);
  return target;
}

module.exports = {
  QDRANT_RUNTIME_CATALOG_PATH,
  parseQdrantRuntimeCatalog,
  readQdrantRuntimeCatalog,
  resolveQdrantRuntimeTarget,
};
