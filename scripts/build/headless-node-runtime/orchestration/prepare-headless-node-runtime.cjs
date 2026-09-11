const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

const JSZip = require('jszip');
const { require: requireTypeScript } = require('tsx/cjs/api');
const { resolveHeadlessNodeRuntime } = requireTypeScript(
  '../../../../src/infra/adapters/headless-node-runtime/index.ts',
  __filename,
);

const {
  readHeadlessNodeRuntimeCatalog,
  resolveHeadlessNodeRuntimeTarget,
} = require('../definitions/headless-node-runtime-catalog.cjs');

const NODE_DISTRIBUTION_BASE_URL = 'https://nodejs.org/dist';
const HEADLESS_NODE_RUNTIME_MANIFEST_FILE_NAME = 'runtime-manifest.json';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function resolvePreparedRuntimeDirectory(rootDir, target) {
  return path.join(
    rootDir,
    'extraResources',
    'headless-node-runtime',
    target.platform,
    target.architecture,
  );
}

function assertHostTarget(platform, architecture) {
  if (platform !== process.platform || architecture !== process.arch) {
    throw new Error(
      `Headless Node runtime 必须在目标宿主上准备：target=${platform}/${architecture} `
      + `host=${process.platform}/${process.arch}`,
    );
  }
}

async function downloadArchive(input) {
  const cachedBytes = await fsp.readFile(input.cachePath).catch(error => {
    if (error && error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (cachedBytes && sha256(cachedBytes) === input.expectedSha256) return cachedBytes;
  if (cachedBytes) await fsp.rm(input.cachePath, { force: true });

  const response = await fetch(input.sourceUrl, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`下载 Headless Node runtime 失败：HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const actualSha256 = sha256(bytes);
  if (actualSha256 !== input.expectedSha256) {
    throw new Error(
      `Headless Node runtime archive checksum 不匹配：expected=${input.expectedSha256} `
      + `actual=${actualSha256}`,
    );
  }

  await fsp.mkdir(path.dirname(input.cachePath), { recursive: true, mode: 0o700 });
  const pendingPath = `${input.cachePath}.pending-${process.pid}-${randomUUID()}`;
  await fsp.writeFile(pendingPath, bytes, { flag: 'wx', mode: 0o600 });
  await fsp.rename(pendingPath, input.cachePath);
  return bytes;
}

async function extractZipRuntime(input) {
  const archive = await JSZip.loadAsync(input.archiveBytes);
  const executableEntry = archive.file(
    `${input.target.archiveRoot}/${input.target.executableRelativePath}`,
  );
  const licenseEntry = archive.file(`${input.target.archiveRoot}/LICENSE`);
  if (!executableEntry || !licenseEntry) {
    throw new Error('Headless Node runtime zip 缺少 node.exe 或 LICENSE');
  }
  await fsp.mkdir(path.dirname(input.executablePath), { recursive: true, mode: 0o755 });
  await Promise.all([
    executableEntry.async('nodebuffer').then(bytes => (
      fsp.writeFile(input.executablePath, bytes, { mode: 0o755 })
    )),
    licenseEntry.async('nodebuffer').then(bytes => (
      fsp.writeFile(input.licensePath, bytes, { mode: 0o644 })
    )),
  ]);
}

async function extractTarGzRuntime(input) {
  const archivePath = path.join(input.stagingDirectory, input.target.archiveFileName);
  const extractionRoot = path.join(input.stagingDirectory, 'archive');
  await fsp.writeFile(archivePath, input.archiveBytes, { mode: 0o600 });
  await fsp.mkdir(extractionRoot, { recursive: true, mode: 0o700 });
  const members = [
    `${input.target.archiveRoot}/${input.target.executableRelativePath}`,
    `${input.target.archiveRoot}/LICENSE`,
  ];
  const result = spawnSync('/usr/bin/tar', [
    '-xzf',
    archivePath,
    '-C',
    extractionRoot,
    ...members,
  ], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(
      `解压 Headless Node runtime 失败：${result.error?.message ?? result.stderr ?? result.stdout}`,
    );
  }
  const extractedRoot = path.join(extractionRoot, input.target.archiveRoot);
  await fsp.mkdir(path.dirname(input.executablePath), { recursive: true, mode: 0o755 });
  await Promise.all([
    fsp.copyFile(
      path.join(extractedRoot, input.target.executableRelativePath),
      input.executablePath,
    ),
    fsp.copyFile(path.join(extractedRoot, 'LICENSE'), input.licensePath),
  ]);
  await Promise.all([
    fsp.chmod(input.executablePath, 0o755),
    fsp.chmod(input.licensePath, 0o644),
  ]);
}

function verifyPreparedNodeExecutable(executablePath, nodeVersion) {
  const result = spawnSync(executablePath, ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error || result.status !== 0 || result.stdout.trim() !== `v${nodeVersion}`) {
    throw new Error(
      `Headless Node runtime 版本验证失败：expected=v${nodeVersion} `
      + `actual=${result.stdout.trim() || result.error?.message || String(result.status)}`,
    );
  }
}

async function clearMacExtendedAttributes(targetPath) {
  if (process.platform !== 'darwin') return;
  const result = spawnSync('/usr/bin/xattr', ['-cr', targetPath], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(
      `清理 Headless Node runtime 扩展属性失败：`
      + `${result.error?.message ?? result.stderr ?? result.stdout}`,
    );
  }
}

async function prepareHeadlessNodeRuntime(input) {
  const catalog = readHeadlessNodeRuntimeCatalog();
  const target = resolveHeadlessNodeRuntimeTarget(catalog, input.platform, input.architecture);
  if (!input.allowCrossTarget) assertHostTarget(target.platform, target.architecture);
  const targetDirectory = resolvePreparedRuntimeDirectory(input.rootDir, target);
  const current = await inspectPreparedHeadlessNodeRuntime({ catalog, target, targetDirectory });
  if (current) {
    if (!input.allowCrossTarget) verifyPreparedNodeExecutable(current.executablePath, catalog.nodeVersion);
    return Object.freeze({ directory: targetDirectory, ...current, changed: false });
  }
  const sourceUrl = `${NODE_DISTRIBUTION_BASE_URL}/v${catalog.nodeVersion}/${target.archiveFileName}`;
  const cachePath = path.join(
    input.rootDir,
    'node_modules',
    '.cache',
    'linnya-headless-node-runtime',
    target.archiveFileName,
  );
  const archiveBytes = await downloadArchive({
    cachePath,
    sourceUrl,
    expectedSha256: target.archiveSha256,
  });

  const parentDirectory = path.dirname(targetDirectory);
  await fsp.mkdir(parentDirectory, { recursive: true, mode: 0o755 });
  const stagingDirectory = await fsp.mkdtemp(
    path.join(parentDirectory, `.pending-${target.architecture}-`),
  );
  const executablePath = path.join(stagingDirectory, target.executableRelativePath);
  const licensePath = path.join(stagingDirectory, 'LICENSE');

  try {
    const extractionInput = {
      archiveBytes,
      executablePath,
      licensePath,
      stagingDirectory,
      target,
    };
    if (target.archiveKind === 'zip') await extractZipRuntime(extractionInput);
    else await extractTarGzRuntime(extractionInput);

    if (!input.allowCrossTarget) {
      verifyPreparedNodeExecutable(executablePath, catalog.nodeVersion);
    }
    const executableBytes = await fsp.readFile(executablePath);
    const manifest = {
      schema_version: catalog.schemaVersion,
      runtime_id: catalog.runtimeId,
      node_version: catalog.nodeVersion,
      platform: target.platform,
      architecture: target.architecture,
      distribution: {
        source_url: sourceUrl,
        archive_file_name: target.archiveFileName,
        archive_sha256: target.archiveSha256,
      },
      prepared_executable: {
        relative_path: target.executableRelativePath.replace(/\\/g, '/'),
        size_bytes: executableBytes.byteLength,
        sha256: sha256(executableBytes),
      },
    };
    await fsp.writeFile(
      path.join(stagingDirectory, HEADLESS_NODE_RUNTIME_MANIFEST_FILE_NAME),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { mode: 0o644 },
    );
    await fsp.rm(path.join(stagingDirectory, target.archiveFileName), { force: true });
    await fsp.rm(path.join(stagingDirectory, 'archive'), { recursive: true, force: true });
    await clearMacExtendedAttributes(stagingDirectory);
    await fsp.rm(targetDirectory, { recursive: true, force: true });
    await fsp.rename(stagingDirectory, targetDirectory);
    return Object.freeze({
      changed: true,
      directory: targetDirectory,
      executablePath: path.join(targetDirectory, target.executableRelativePath),
      manifestPath: path.join(targetDirectory, HEADLESS_NODE_RUNTIME_MANIFEST_FILE_NAME),
    });
  } catch (error) {
    await fsp.rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}

/** 复用正式 runtime 验证器；下载缓存命中不等于已经安装的可执行文件仍然完整。 */
async function inspectPreparedHeadlessNodeRuntime({ catalog, target, targetDirectory }) {
  try {
    return await resolveHeadlessNodeRuntime({
      catalog,
      runtimeDirectory: targetDirectory,
      platform: target.platform,
      architecture: target.architecture,
      verifyPreparedExecutableHash: true,
    });
  } catch (error) {
    // 权限或 I/O 错误不应触发替换；缺失、过期或损坏的制品才由准备链重建。
    if (error?.code && error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    return null;
  }
}

module.exports = {
  NODE_DISTRIBUTION_BASE_URL,
  HEADLESS_NODE_RUNTIME_MANIFEST_FILE_NAME,
  prepareHeadlessNodeRuntime,
  inspectPreparedHeadlessNodeRuntime,
  resolvePreparedRuntimeDirectory,
  sha256,
};
