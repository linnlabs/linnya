const { randomUUID } = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const JSZip = require('jszip');

const {
  readPopplerRuntimeCatalog,
  resolvePopplerRuntimeTarget,
} = require('../definitions/poppler-runtime-catalog.cjs');
const {
  inspectPopplerRuntimeDirectory,
  inspectPreparedPopplerRuntime,
  resolvePreparedPopplerDirectory,
  sha256,
} = require('../functions/poppler-runtime-integrity.cjs');

function assertHostTarget(platform, architecture) {
  if (platform !== process.platform || architecture !== process.arch) {
    throw new Error(
      `Poppler runtime 必须在目标宿主上准备：target=${platform}/${architecture} ` +
        `host=${process.platform}/${process.arch}`
    );
  }
}

async function downloadArchive(input) {
  const cachedBytes = await fsp.readFile(input.cachePath).catch(error => {
    if (error && error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (
    cachedBytes &&
    cachedBytes.byteLength === input.expectedSizeBytes &&
    sha256(cachedBytes) === input.expectedSha256
  ) {
    return cachedBytes;
  }
  if (cachedBytes) await fsp.rm(input.cachePath, { force: true });

  const response = await globalThis.fetch(input.sourceUrl, { redirect: 'follow' });
  if (!response.ok) throw new Error(`下载 Poppler runtime 失败：HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actualSha256 = sha256(bytes);
  if (bytes.byteLength !== input.expectedSizeBytes || actualSha256 !== input.expectedSha256) {
    throw new Error(
      `Poppler runtime archive 校验失败：expectedSize=${input.expectedSizeBytes} ` +
        `actualSize=${bytes.byteLength} expectedSha256=${input.expectedSha256} ` +
        `actualSha256=${actualSha256}`
    );
  }

  await fsp.mkdir(path.dirname(input.cachePath), { recursive: true, mode: 0o700 });
  const pendingPath = `${input.cachePath}.pending-${process.pid}-${randomUUID()}`;
  await fsp.writeFile(pendingPath, bytes, { flag: 'wx', mode: 0o600 });
  await fsp.rename(pendingPath, input.cachePath);
  return bytes;
}

function assertSafeArchivePath(relativePath) {
  const segments = relativePath.split('/').filter(Boolean);
  if (
    path.isAbsolute(relativePath) ||
    segments.length === 0 ||
    segments.includes('.') ||
    segments.includes('..')
  ) {
    throw new Error(`Poppler runtime archive 含不安全路径：${relativePath}`);
  }
  return segments;
}

async function extractRuntimeArchive(archiveBytes, stagingDirectory) {
  const archive = await JSZip.loadAsync(archiveBytes);
  const caseInsensitivePaths = new Set();

  for (const entry of Object.values(archive.files).sort((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    if (entry.dir) continue;
    const segments = assertSafeArchivePath(entry.name);
    const normalized = segments.join('/').toLowerCase();
    if (caseInsensitivePaths.has(normalized)) {
      throw new Error(`Poppler runtime archive 路径重复：${entry.name}`);
    }
    caseInsensitivePaths.add(normalized);

    const outputPath = path.join(stagingDirectory, ...segments);
    await fsp.mkdir(path.dirname(outputPath), { recursive: true, mode: 0o755 });
    await fsp.writeFile(outputPath, await entry.async('nodebuffer'), { mode: 0o644 });
  }
}

function verifyExecutableVersion(executablePath, version) {
  const result = spawnSync(executablePath, ['-v'], { encoding: 'utf8', windowsHide: true });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.error || result.status !== 0 || !output.includes(`pdftocairo version ${version}`)) {
    throw new Error(
      `Poppler runtime 版本验证失败：expected=${version} ` +
        `actual=${output.trim() || result.error?.message || String(result.status)}`
    );
  }
}

async function clearMacExtendedAttributes(targetPath) {
  if (process.platform !== 'darwin') return;
  const result = spawnSync('/usr/bin/xattr', ['-cr', targetPath], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(
      `清理 Poppler runtime 扩展属性失败：` +
        `${result.error?.message ?? result.stderr ?? result.stdout}`
    );
  }
}

async function preparePopplerRuntime(input) {
  const catalog = readPopplerRuntimeCatalog();
  const target = resolvePopplerRuntimeTarget(catalog, input.platform, input.architecture);
  if (!input.allowCrossTarget) assertHostTarget(target.platform, target.architecture);

  const current = inspectPreparedPopplerRuntime(input.rootDir, target);
  if (current.ready) {
    return Object.freeze({
      executablePath: current.executablePath,
      changed: false,
      version: target.version,
    });
  }

  const cachePath = path.join(
    input.rootDir,
    'node_modules',
    '.cache',
    'linnya-poppler-runtime',
    target.archiveFileName
  );
  const archiveBytes = await downloadArchive({
    cachePath,
    sourceUrl: target.archiveUrl,
    expectedSizeBytes: target.archiveSizeBytes,
    expectedSha256: target.archiveSha256,
  });

  const targetDirectory = resolvePreparedPopplerDirectory(input.rootDir, target);
  const parentDirectory = path.dirname(targetDirectory);
  await fsp.mkdir(parentDirectory, { recursive: true, mode: 0o755 });
  const stagingDirectory = await fsp.mkdtemp(
    path.join(parentDirectory, `.pending-${target.outputDirectory}-`)
  );

  try {
    await extractRuntimeArchive(archiveBytes, stagingDirectory);
    const executablePath = path.join(stagingDirectory, target.executableFileName);
    await fsp.chmod(executablePath, target.platform === 'win32' ? 0o644 : 0o755);

    const prepared = inspectPopplerRuntimeDirectory(stagingDirectory, target);
    if (!prepared.ready) {
      throw new Error(`Poppler runtime 解包校验失败：${prepared.reason}`);
    }
    if (!input.allowCrossTarget) verifyExecutableVersion(executablePath, target.version);
    await clearMacExtendedAttributes(stagingDirectory);
    await fsp.rm(targetDirectory, { recursive: true, force: true });
    await fsp.rename(stagingDirectory, targetDirectory);

    return Object.freeze({
      executablePath: path.join(targetDirectory, target.executableFileName),
      changed: true,
      version: target.version,
    });
  } catch (error) {
    await fsp.rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { preparePopplerRuntime };
