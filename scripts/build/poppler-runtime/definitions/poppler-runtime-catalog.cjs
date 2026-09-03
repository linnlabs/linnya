const fs = require('node:fs');
const path = require('node:path');

const POPPLER_RUNTIME_CATALOG_PATH = path.resolve(
  __dirname,
  '../../../../config/poppler-runtime.json'
);

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

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

function readPositiveInteger(record, key, label) {
  const value = record[key];
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} 的 ${key} 必须是正整数`);
  }
  return value;
}

function readSha256(record, key, label) {
  const value = readRequiredString(record, key, label);
  if (!SHA256_PATTERN.test(value)) throw new Error(`${label} 的 ${key} 不是 SHA-256`);
  return value;
}

function assertSinglePathSegment(value, label) {
  if (path.isAbsolute(value) || path.basename(value) !== value || value === '.' || value === '..') {
    throw new Error(`${label} 必须是单个安全路径段`);
  }
}

function parseDistribution(value) {
  if (!isRecord(value)) throw new Error('Poppler runtime catalog 缺少 distribution');
  const repositoryUrl = readRequiredString(value, 'repository_url', 'Poppler distribution');
  const releaseTag = readRequiredString(value, 'release_tag', 'Poppler distribution');
  const popplerLicenseExpression = readRequiredString(
    value,
    'poppler_license_expression',
    'Poppler distribution'
  );
  const sourceRepositoryUrl = readRequiredString(
    value,
    'source_repository_url',
    'Poppler distribution'
  );

  if (
    repositoryUrl !== 'https://github.com/linnlabs/linnya' ||
    !/^poppler-runtime-v\d+$/.test(releaseTag) ||
    popplerLicenseExpression !== 'GPL-2.0-only OR GPL-3.0-only' ||
    sourceRepositoryUrl !== 'https://gitlab.freedesktop.org/poppler/poppler'
  ) {
    throw new Error('Poppler distribution 必须锁定 Linnya release、Poppler source 与许可证');
  }

  return Object.freeze({
    repositoryUrl,
    releaseTag,
    popplerLicenseExpression,
    sourceRepositoryUrl,
  });
}

function parseTarget(value, distribution) {
  if (!isRecord(value)) throw new Error('Poppler runtime target 必须是对象');
  const label = 'Poppler runtime target';
  const platform = readRequiredString(value, 'platform', label);
  const architecture = readRequiredString(value, 'architecture', label);
  const version = readRequiredString(value, 'version', label);
  const outputDirectory = readRequiredString(value, 'output_directory', label);
  const archiveFileName = readRequiredString(value, 'archive_file_name', label);
  const archiveUrl = readRequiredString(value, 'archive_url', label);
  const archiveSizeBytes = readPositiveInteger(value, 'archive_size_bytes', label);
  const archiveSha256 = readSha256(value, 'archive_sha256', label);
  const fileCount = readPositiveInteger(value, 'file_count', label);
  const treeSha256 = readSha256(value, 'tree_sha256', label);
  const executableFileName = readRequiredString(value, 'executable_file_name', label);
  const executableSizeBytes = readPositiveInteger(value, 'executable_size_bytes', label);
  const executableSha256 = readSha256(value, 'executable_sha256', label);

  assertSinglePathSegment(outputDirectory, `${label} output_directory`);
  assertSinglePathSegment(archiveFileName, `${label} archive_file_name`);
  assertSinglePathSegment(executableFileName, `${label} executable_file_name`);

  const expectedArchiveUrl =
    `${distribution.repositoryUrl}/releases/download/${distribution.releaseTag}/` + archiveFileName;
  if (
    !/^\d+\.\d+\.\d+$/.test(version) ||
    archiveUrl !== expectedArchiveUrl ||
    (platform === 'darwin' && architecture !== 'arm64') ||
    (platform === 'win32' && architecture !== 'x64') ||
    (platform !== 'darwin' && platform !== 'win32')
  ) {
    throw new Error(`Poppler runtime target 无效：${platform}/${architecture}`);
  }

  return Object.freeze({
    platform,
    architecture,
    version,
    outputDirectory,
    archiveFileName,
    archiveUrl,
    archiveSizeBytes,
    archiveSha256,
    fileCount,
    treeSha256,
    executableFileName,
    executableSizeBytes,
    executableSha256,
  });
}

function parsePopplerRuntimeCatalog(value) {
  if (
    !isRecord(value) ||
    value.schema_version !== 1 ||
    value.runtime_id !== 'linnya_poppler_runtime' ||
    !Array.isArray(value.targets) ||
    value.targets.length === 0
  ) {
    throw new Error('Poppler runtime catalog 基础字段无效');
  }

  const distribution = parseDistribution(value.distribution);
  const identities = new Set();
  const outputDirectories = new Set();
  const targets = value.targets.map(candidate => {
    const target = parseTarget(candidate, distribution);
    const identity = `${target.platform}/${target.architecture}`;
    if (identities.has(identity)) throw new Error(`Poppler runtime target 重复：${identity}`);
    if (outputDirectories.has(target.outputDirectory)) {
      throw new Error(`Poppler runtime output_directory 重复：${target.outputDirectory}`);
    }
    identities.add(identity);
    outputDirectories.add(target.outputDirectory);
    return target;
  });

  return Object.freeze({
    schemaVersion: 1,
    runtimeId: value.runtime_id,
    distribution,
    targets: Object.freeze(targets),
  });
}

function readPopplerRuntimeCatalog() {
  return parsePopplerRuntimeCatalog(
    JSON.parse(fs.readFileSync(POPPLER_RUNTIME_CATALOG_PATH, 'utf8'))
  );
}

function resolvePopplerRuntimeTarget(catalog, platform, architecture) {
  const target = catalog.targets.find(
    candidate => candidate.platform === platform && candidate.architecture === architecture
  );
  if (!target) throw new Error(`不支持 Poppler runtime 目标：${platform}/${architecture}`);
  return target;
}

module.exports = {
  POPPLER_RUNTIME_CATALOG_PATH,
  parsePopplerRuntimeCatalog,
  readPopplerRuntimeCatalog,
  resolvePopplerRuntimeTarget,
};
