const { randomUUID } = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const JSZip = require('jszip');

const {
  readQdrantRuntimeCatalog,
  resolveQdrantRuntimeTarget,
} = require('../definitions/qdrant-runtime-catalog.cjs');
const {
  inspectQdrantExecutable,
  inspectPreparedQdrantRuntime,
  resolvePreparedQdrantDirectory,
  sha256,
} = require('../functions/qdrant-runtime-integrity.cjs');

function assertHostTarget(platform, architecture) {
  if (platform !== process.platform || architecture !== process.arch) {
    throw new Error(
      `Qdrant runtime 必须在目标宿主上准备：target=${platform}/${architecture} ` +
        `host=${process.platform}/${process.arch}`
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

  const response = await globalThis.fetch(input.sourceUrl, { redirect: 'follow' });
  if (!response.ok) throw new Error(`下载 Qdrant runtime 失败：HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actualSha256 = sha256(bytes);
  if (actualSha256 !== input.expectedSha256) {
    throw new Error(
      `Qdrant runtime archive checksum 不匹配：expected=${input.expectedSha256} ` +
        `actual=${actualSha256}`
    );
  }

  await fsp.mkdir(path.dirname(input.cachePath), { recursive: true, mode: 0o700 });
  const pendingPath = `${input.cachePath}.pending-${process.pid}-${randomUUID()}`;
  await fsp.writeFile(pendingPath, bytes, { flag: 'wx', mode: 0o600 });
  await fsp.rename(pendingPath, input.cachePath);
  return bytes;
}

async function extractZipExecutable(archiveBytes, archiveEntry, executablePath) {
  const archive = await JSZip.loadAsync(archiveBytes);
  const executableEntry = archive.file(archiveEntry);
  const files = Object.values(archive.files).filter(entry => !entry.dir);
  if (!executableEntry || files.length !== 1) {
    throw new Error(`Qdrant zip 必须只包含 ${archiveEntry}`);
  }
  const bytes = await executableEntry.async('nodebuffer');
  await fsp.writeFile(executablePath, bytes, { mode: 0o644 });
}

async function extractTarGzExecutable(input) {
  const archivePath = path.join(input.stagingDirectory, input.target.archiveFileName);
  await fsp.writeFile(archivePath, input.archiveBytes, { mode: 0o600 });
  const result = spawnSync(
    '/usr/bin/tar',
    ['-xzf', archivePath, '-C', input.stagingDirectory, input.target.archiveEntry],
    { encoding: 'utf8' }
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `解压 Qdrant runtime 失败：${result.error?.message ?? result.stderr ?? result.stdout}`
    );
  }
  const extractedPath = path.join(input.stagingDirectory, input.target.archiveEntry);
  if (extractedPath !== input.executablePath) {
    await fsp.rename(extractedPath, input.executablePath);
  }
  await fsp.rm(archivePath, { force: true });
}

function verifyExecutableVersion(executablePath, version) {
  const result = spawnSync(executablePath, ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error || result.status !== 0 || result.stdout.trim() !== `qdrant ${version}`) {
    throw new Error(
      `Qdrant runtime 版本验证失败：expected=${version} ` +
        `actual=${result.stdout.trim() || result.error?.message || String(result.status)}`
    );
  }
}

async function clearMacExtendedAttributes(targetPath) {
  if (process.platform !== 'darwin') return;
  const result = spawnSync('/usr/bin/xattr', ['-cr', targetPath], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(
      `清理 Qdrant runtime 扩展属性失败：` +
        `${result.error?.message ?? result.stderr ?? result.stdout}`
    );
  }
}

async function prepareQdrantRuntime(input) {
  const catalog = readQdrantRuntimeCatalog();
  const target = resolveQdrantRuntimeTarget(catalog, input.platform, input.architecture);
  if (!input.allowCrossTarget) assertHostTarget(target.platform, target.architecture);

  const current = inspectPreparedQdrantRuntime(input.rootDir, target);
  if (current.ready) {
    return Object.freeze({
      executablePath: current.executablePath,
      changed: false,
      version: catalog.version,
    });
  }

  const cachePath = path.join(
    input.rootDir,
    'node_modules',
    '.cache',
    'linnya-qdrant-runtime',
    target.archiveFileName
  );
  const archiveBytes = await downloadArchive({
    cachePath,
    sourceUrl: target.archiveUrl,
    expectedSha256: target.archiveSha256,
  });

  const targetDirectory = resolvePreparedQdrantDirectory(input.rootDir, target);
  const parentDirectory = path.dirname(targetDirectory);
  await fsp.mkdir(parentDirectory, { recursive: true, mode: 0o755 });
  const stagingDirectory = await fsp.mkdtemp(
    path.join(parentDirectory, `.pending-${target.outputDirectory}-`)
  );
  const executablePath = path.join(stagingDirectory, target.executableFileName);

  try {
    if (target.archiveKind === 'zip') {
      await extractZipExecutable(archiveBytes, target.archiveEntry, executablePath);
    } else {
      await extractTarGzExecutable({ archiveBytes, executablePath, stagingDirectory, target });
    }
    await fsp.chmod(executablePath, target.platform === 'win32' ? 0o644 : 0o755);

    const prepared = inspectQdrantExecutable(executablePath, target);
    if (!prepared.ready) {
      throw new Error(
        `Qdrant executable 校验失败：reason=${prepared.reason} ` +
          `sha256=${prepared.actualSha256 ?? 'missing'}`
      );
    }
    if (!input.allowCrossTarget) verifyExecutableVersion(executablePath, catalog.version);
    await clearMacExtendedAttributes(stagingDirectory);
    await fsp.rm(targetDirectory, { recursive: true, force: true });
    await fsp.rename(stagingDirectory, targetDirectory);
    return Object.freeze({
      executablePath: path.join(targetDirectory, target.executableFileName),
      changed: true,
      version: catalog.version,
    });
  } catch (error) {
    await fsp.rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { prepareQdrantRuntime };
