const fs = require('node:fs');
const path = require('node:path');

const EXPECTED_NODE_PTY_VERSION = '1.2.0-beta.14';
const SUPPORTED_TARGETS = new Set([
  'darwin:arm64',
  'darwin:x64',
  'win32:arm64',
  'win32:x64',
]);
const MACOS_RUNTIME_ENTRIES = new Set(['LICENSE', 'lib', 'package.json', 'prebuilds']);
const MACOS_PREBUILD_ENTRIES = new Set(['pty.node', 'spawn-helper']);
const MACHO_64_MAGIC_LE = 0xfeedfacf;
const MACHO_CPU_TYPES = Object.freeze({
  arm64: 0x0100000c,
  x64: 0x01000007,
});

function readRequiredArgument(args, name) {
  const index = args.indexOf(name);
  const value = index === -1 ? undefined : args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function assertRegularNonEmptyFile(filePath, label) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`${label} must be a regular non-empty file: ${filePath}`);
  }
  return stat;
}

function inspectThinMacOsArchitecture(filePath) {
  const descriptor = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(8);
    if (fs.readSync(descriptor, header, 0, header.byteLength, 0) !== header.byteLength) {
      throw new Error(`Mach-O header is truncated: ${filePath}`);
    }
    if (header.readUInt32LE(0) !== MACHO_64_MAGIC_LE) {
      throw new Error(`Expected a thin 64-bit Mach-O file: ${filePath}`);
    }
    const cpuType = header.readUInt32LE(4);
    const architecture = Object.entries(MACHO_CPU_TYPES)
      .find(([, expectedCpuType]) => cpuType === expectedCpuType)?.[0];
    if (!architecture) {
      throw new Error(`Unsupported Mach-O CPU type ${cpuType}: ${filePath}`);
    }
    return architecture;
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertNodePtyPackage(nodePtyDirectory) {
  const packageJson = readJson(path.join(nodePtyDirectory, 'package.json'));
  if (
    packageJson.name !== 'node-pty'
    || packageJson.version !== EXPECTED_NODE_PTY_VERSION
    || packageJson.license !== 'MIT'
  ) {
    throw new Error(
      `node-pty package identity mismatch: expected node-pty@${EXPECTED_NODE_PTY_VERSION} MIT`,
    );
  }
  assertRegularNonEmptyFile(path.join(nodePtyDirectory, 'LICENSE'), 'node-pty LICENSE');

  const unexpectedBuildDirectory = path.join(nodePtyDirectory, 'build', 'Release');
  if (fs.existsSync(unexpectedBuildDirectory)) {
    throw new Error(
      `node-pty build/Release is forbidden because it precedes prebuilds at runtime: ${unexpectedBuildDirectory}`,
    );
  }
}

function pruneRuntimeJavaScript(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`node-pty runtime JavaScript must not contain symlinks: ${entryPath}`);
    }
    if (entry.isDirectory()) {
      pruneRuntimeJavaScript(entryPath);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`node-pty runtime JavaScript contains a non-file entry: ${entryPath}`);
    }
    if (path.extname(entry.name) !== '.js') {
      fs.rmSync(entryPath, { force: true });
      continue;
    }
    assertRegularNonEmptyFile(entryPath, 'node-pty runtime JavaScript');
  }
}

function prepareMacOsNodePty(nodePtyDirectory, architecture) {
  assertNodePtyPackage(nodePtyDirectory);
  const targetPrebuildDirectory = path.join(
    nodePtyDirectory,
    'prebuilds',
    `darwin-${architecture}`,
  );
  const addonPath = path.join(targetPrebuildDirectory, 'pty.node');
  const helperPath = path.join(targetPrebuildDirectory, 'spawn-helper');
  const addonStat = assertRegularNonEmptyFile(addonPath, 'node-pty pty.node');
  const helperStat = assertRegularNonEmptyFile(helperPath, 'node-pty spawn-helper');
  if ((addonStat.mode & 0o111) !== 0) {
    throw new Error(`node-pty pty.node must not be executable: ${addonPath}`);
  }
  if ((helperStat.mode & 0o111) === 0) {
    throw new Error(`node-pty spawn-helper must be executable: ${helperPath}`);
  }
  for (const filePath of [addonPath, helperPath]) {
    const actualArchitecture = inspectThinMacOsArchitecture(filePath);
    if (actualArchitecture !== architecture) {
      throw new Error(
        `node-pty Mach-O architecture mismatch: expected ${architecture}, got ${actualArchitecture}: ${filePath}`,
      );
    }
  }

  for (const entry of fs.readdirSync(nodePtyDirectory)) {
    if (!MACOS_RUNTIME_ENTRIES.has(entry)) {
      fs.rmSync(path.join(nodePtyDirectory, entry), { recursive: true, force: true });
    }
  }
  pruneRuntimeJavaScript(path.join(nodePtyDirectory, 'lib'));
  const prebuildsDirectory = path.join(nodePtyDirectory, 'prebuilds');
  for (const entry of fs.readdirSync(prebuildsDirectory)) {
    if (entry !== `darwin-${architecture}`) {
      fs.rmSync(path.join(prebuildsDirectory, entry), { recursive: true, force: true });
    }
  }
  for (const entry of fs.readdirSync(targetPrebuildDirectory)) {
    if (!MACOS_PREBUILD_ENTRIES.has(entry)) {
      fs.rmSync(path.join(targetPrebuildDirectory, entry), { recursive: true, force: true });
    }
  }

  const remainingTopLevelEntries = fs.readdirSync(nodePtyDirectory);
  if (remainingTopLevelEntries.some(entry => !MACOS_RUNTIME_ENTRIES.has(entry))) {
    throw new Error('node-pty macOS runtime pruning left an unexpected top-level entry');
  }
  const remainingPrebuildDirectories = fs.readdirSync(prebuildsDirectory);
  if (
    remainingPrebuildDirectories.length !== 1
    || remainingPrebuildDirectories[0] !== `darwin-${architecture}`
  ) {
    throw new Error('node-pty macOS runtime pruning left an unexpected prebuild directory');
  }
  const remainingTargetEntries = fs.readdirSync(targetPrebuildDirectory).sort();
  if (remainingTargetEntries.join('\n') !== [...MACOS_PREBUILD_ENTRIES].sort().join('\n')) {
    throw new Error('node-pty macOS runtime pruning left an unexpected native file');
  }
}

function excludeWindowsNodePty(projectDirectory, nodePtyDirectory) {
  assertNodePtyPackage(nodePtyDirectory);
  const packagePath = path.join(projectDirectory, 'package.json');
  const packageJson = readJson(packagePath);
  if (packageJson.dependencies?.['node-pty'] !== EXPECTED_NODE_PTY_VERSION) {
    throw new Error('dist_build package.json must contain the exact node-pty dependency before pruning');
  }
  delete packageJson.dependencies['node-pty'];
  fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
  fs.rmSync(nodePtyDirectory, { recursive: true, force: false });
  if (fs.existsSync(nodePtyDirectory)) {
    throw new Error(`Windows node-pty runtime was not removed: ${nodePtyDirectory}`);
  }
}

function prepareNodePtyRuntime({ projectDirectory, platform, architecture }) {
  const target = `${platform}:${architecture}`;
  if (!SUPPORTED_TARGETS.has(target)) {
    throw new Error(`Unsupported node-pty packaging target: ${target}`);
  }
  const nodePtyDirectory = path.join(projectDirectory, 'node_modules', 'node-pty');
  if (!fs.existsSync(nodePtyDirectory)) {
    throw new Error(`node-pty package is missing from the build tree: ${nodePtyDirectory}`);
  }
  if (platform === 'darwin') {
    prepareMacOsNodePty(nodePtyDirectory, architecture);
    return;
  }
  excludeWindowsNodePty(projectDirectory, nodePtyDirectory);
}

function main(args) {
  const projectDirectory = path.resolve(readRequiredArgument(args, '--project-dir'));
  const platform = readRequiredArgument(args, '--platform');
  const architecture = readRequiredArgument(args, '--arch');
  prepareNodePtyRuntime({ projectDirectory, platform, architecture });
  console.log(`node-pty packaging prepared for ${platform}-${architecture}`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  EXPECTED_NODE_PTY_VERSION,
  inspectThinMacOsArchitecture,
  prepareNodePtyRuntime,
};
