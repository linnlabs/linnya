const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readRuntimeFiles(directory, relativeDirectory = '') {
  const absoluteDirectory = path.join(directory, relativeDirectory);
  const files = [];
  for (const name of fs.readdirSync(absoluteDirectory).sort()) {
    const relativePath = relativeDirectory ? `${relativeDirectory}/${name}` : name;
    const absolutePath = path.join(directory, ...relativePath.split('/'));
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
      throw new Error(`Poppler runtime 只允许常规目录和文件：${relativePath}`);
    }
    if (stat.isDirectory()) files.push(...readRuntimeFiles(directory, relativePath));
    if (stat.isFile()) files.push(relativePath);
  }
  return files;
}

function calculateRuntimeTree(directory) {
  const files = readRuntimeFiles(directory);
  const lines = files.map(relativePath => {
    const bytes = fs.readFileSync(path.join(directory, ...relativePath.split('/')));
    return `${bytes.byteLength} ${sha256(bytes)} ${relativePath}\n`;
  });
  return Object.freeze({
    fileCount: files.length,
    treeSha256: sha256(Buffer.from(lines.join(''))),
  });
}

function resolvePreparedPopplerDirectory(rootDir, target) {
  return path.join(rootDir, 'extraResources', 'bin', 'poppler', target.outputDirectory);
}

function inspectPopplerRuntimeDirectory(directory, target) {
  if (!fs.existsSync(directory)) {
    return Object.freeze({ directory, ready: false, reason: 'missing' });
  }

  const tree = calculateRuntimeTree(directory);
  if (tree.fileCount !== target.fileCount || tree.treeSha256 !== target.treeSha256) {
    return Object.freeze({ directory, ready: false, reason: 'tree-mismatch', ...tree });
  }

  const executablePath = path.join(directory, target.executableFileName);
  const executableBytes = fs.readFileSync(executablePath);
  const executableSha256 = sha256(executableBytes);
  if (
    executableBytes.byteLength !== target.executableSizeBytes ||
    executableSha256 !== target.executableSha256
  ) {
    return Object.freeze({
      directory,
      executablePath,
      ready: false,
      reason: 'executable-mismatch',
      executableSizeBytes: executableBytes.byteLength,
      executableSha256,
    });
  }

  return Object.freeze({ directory, executablePath, ready: true, ...tree, executableSha256 });
}

function inspectPreparedPopplerRuntime(rootDir, target) {
  return inspectPopplerRuntimeDirectory(resolvePreparedPopplerDirectory(rootDir, target), target);
}

module.exports = {
  calculateRuntimeTree,
  inspectPopplerRuntimeDirectory,
  inspectPreparedPopplerRuntime,
  readRuntimeFiles,
  resolvePreparedPopplerDirectory,
  sha256,
};
