const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function resolvePreparedQdrantDirectory(rootDir, target) {
  return path.join(rootDir, 'extraResources', 'bin', 'qdrant', target.outputDirectory);
}

function resolvePreparedQdrantExecutable(rootDir, target) {
  return path.join(resolvePreparedQdrantDirectory(rootDir, target), target.executableFileName);
}

function inspectQdrantExecutable(executablePath, target) {
  let bytes;
  try {
    bytes = fs.readFileSync(executablePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return Object.freeze({ executablePath, ready: false, reason: 'missing' });
    }
    throw error;
  }

  const actualSha256 = sha256(bytes);
  if (bytes.byteLength !== target.executableSizeBytes) {
    return Object.freeze({
      executablePath,
      ready: false,
      reason: 'size-mismatch',
      actualSizeBytes: bytes.byteLength,
      actualSha256,
    });
  }
  if (actualSha256 !== target.executableSha256) {
    return Object.freeze({
      executablePath,
      ready: false,
      reason: 'checksum-mismatch',
      actualSizeBytes: bytes.byteLength,
      actualSha256,
    });
  }
  return Object.freeze({
    executablePath,
    ready: true,
    actualSizeBytes: bytes.byteLength,
    actualSha256,
  });
}

function inspectPreparedQdrantRuntime(rootDir, target) {
  return inspectQdrantExecutable(resolvePreparedQdrantExecutable(rootDir, target), target);
}

module.exports = {
  inspectQdrantExecutable,
  inspectPreparedQdrantRuntime,
  resolvePreparedQdrantDirectory,
  resolvePreparedQdrantExecutable,
  sha256,
};
