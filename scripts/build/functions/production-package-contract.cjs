const fs = require('node:fs');
const path = require('node:path');

const SUPPORTED_NATIVE_TARGETS = new Set([
  'darwin:arm64',
  'darwin:x64',
  'linux:arm64',
  'linux:x64',
  'win32:arm64',
  'win32:x64',
]);
const SUPPORTED_PACKAGE_BUILD_TARGETS = new Set([
  'darwin:arm64',
  'darwin:x64',
  'win32:arm64',
  'win32:x64',
]);
const MACHO_64_MAGIC_LE = 0xfeedfacf;
const MACHO_CPU_TYPES = Object.freeze({ arm64: 0x0100000c, x64: 0x01000007 });
const PE_MACHINE_TYPES = Object.freeze({ arm64: 0xaa64, x64: 0x8664 });
const ELF_MACHINE_TYPES = Object.freeze({ arm64: 0xb7, x64: 0x3e });
const WINDOWS_VC_RUNTIME_SOURCE_ENV_NAME = 'LINNYA_WINDOWS_VC_RUNTIME_DIR';
const WINDOWS_COMMAND_RUNTIME_BUILD_TRUST_ENV_NAME =
  'LINNYA_WINDOWS_COMMAND_RUNTIME_BUILD_TRUST';
const WINDOWS_EXPECTED_PUBLISHER_IDENTITY_ENV_NAME =
  'LINNYA_WINDOWS_EXPECTED_PUBLISHER_IDENTITY';
const WINDOWS_VC_RUNTIME_REQUIRED_FILES = Object.freeze([
  'msvcp140.dll',
  'vcruntime140.dll',
  'vcruntime140_1.dll',
]);

function assertSupportedNativeTarget(platform, architecture) {
  if (!SUPPORTED_NATIVE_TARGETS.has(`${platform}:${architecture}`)) {
    throw new Error(`Unsupported native package target: ${platform}/${architecture}`);
  }
}

function resolveWindowsReleaseCommandRuntimeEnvironment(environment) {
  const expectedPublisherIdentity =
    environment[WINDOWS_EXPECTED_PUBLISHER_IDENTITY_ENV_NAME];
  if (
    typeof expectedPublisherIdentity !== 'string'
    || expectedPublisherIdentity.trim().length === 0
  ) {
    throw new Error(
      `${WINDOWS_EXPECTED_PUBLISHER_IDENTITY_ENV_NAME} is required for a release Windows build`,
    );
  }
  return Object.freeze({
    [WINDOWS_COMMAND_RUNTIME_BUILD_TRUST_ENV_NAME]: 'release',
    [WINDOWS_EXPECTED_PUBLISHER_IDENTITY_ENV_NAME]: expectedPublisherIdentity,
  });
}

function inspectNativeBinaryTarget(filePath) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`Native artifact must be a regular non-empty file: ${filePath}`);
  }
  const descriptor = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(Math.min(stat.size, 4096));
    fs.readSync(descriptor, header, 0, header.byteLength, 0);
    if (header.byteLength >= 8 && header.readUInt32LE(0) === MACHO_64_MAGIC_LE) {
      const cpuType = header.readUInt32LE(4);
      const architecture = Object.entries(MACHO_CPU_TYPES)
        .find(([, expected]) => cpuType === expected)?.[0];
      if (!architecture) throw new Error(`Unsupported Mach-O CPU type ${cpuType}: ${filePath}`);
      return { platform: 'darwin', architecture };
    }
    if (header.byteLength >= 64 && header[0] === 0x4d && header[1] === 0x5a) {
      const peOffset = header.readUInt32LE(0x3c);
      if (peOffset + 6 > header.byteLength) {
        throw new Error(`PE header is outside the inspected native artifact header: ${filePath}`);
      }
      if (header.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
        throw new Error(`Invalid PE signature: ${filePath}`);
      }
      const machineType = header.readUInt16LE(peOffset + 4);
      const architecture = Object.entries(PE_MACHINE_TYPES)
        .find(([, expected]) => machineType === expected)?.[0];
      if (!architecture) throw new Error(`Unsupported PE machine type ${machineType}: ${filePath}`);
      return { platform: 'win32', architecture };
    }
    if (
      header.byteLength >= 20
      && header[0] === 0x7f
      && header.toString('ascii', 1, 4) === 'ELF'
    ) {
      if (header[4] !== 2 || header[5] !== 1) {
        throw new Error(`Expected a little-endian 64-bit ELF native artifact: ${filePath}`);
      }
      const machineType = header.readUInt16LE(18);
      const architecture = Object.entries(ELF_MACHINE_TYPES)
        .find(([, expected]) => machineType === expected)?.[0];
      if (!architecture) throw new Error(`Unsupported ELF machine type ${machineType}: ${filePath}`);
      return { platform: 'linux', architecture };
    }
    throw new Error(`Unsupported native artifact format: ${filePath}`);
  } finally {
    fs.closeSync(descriptor);
  }
}

function resolveWindowsVcRuntimeSource({ environment, architecture }) {
  assertSupportedNativeTarget('win32', architecture);
  const explicitSource = environment[WINDOWS_VC_RUNTIME_SOURCE_ENV_NAME];
  if (explicitSource) return path.resolve(explicitSource);

  const toolsRedistDirectory = environment.VCToolsRedistDir;
  if (!toolsRedistDirectory) {
    throw new Error(
      `Windows production builds require ${WINDOWS_VC_RUNTIME_SOURCE_ENV_NAME} `
      + 'or VCToolsRedistDir from a licensed Visual Studio Build Tools environment',
    );
  }
  const architectureDirectory = path.resolve(toolsRedistDirectory, architecture);
  const candidates = fs.readdirSync(architectureDirectory, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^Microsoft\.VC\d+\.CRT$/.test(entry.name))
    .map(entry => path.join(architectureDirectory, entry.name));
  if (candidates.length !== 1) {
    throw new Error(
      `Expected exactly one Microsoft.VC*.CRT directory in ${architectureDirectory}, `
      + `found ${candidates.length}. Set ${WINDOWS_VC_RUNTIME_SOURCE_ENV_NAME} explicitly.`,
    );
  }
  return candidates[0];
}

function prepareWindowsAppLocalRuntime({
  sourceDirectory,
  targetDirectory,
  architecture,
  verifySourceFile = () => {},
}) {
  assertSupportedNativeTarget('win32', architecture);
  const entries = fs.readdirSync(sourceDirectory, { withFileTypes: true });
  const sourceFilesByName = new Map(
    entries
      .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.dll'))
      .map(entry => [entry.name.toLowerCase(), entry.name]),
  );
  for (const requiredFileName of WINDOWS_VC_RUNTIME_REQUIRED_FILES) {
    if (!sourceFilesByName.has(requiredFileName)) {
      throw new Error(`Windows VC runtime source is missing ${requiredFileName}: ${sourceDirectory}`);
    }
  }
  const runtimeFiles = [...sourceFilesByName.values()].sort();
  for (const fileName of runtimeFiles) {
    const sourcePath = path.join(sourceDirectory, fileName);
    const actualTarget = inspectNativeBinaryTarget(sourcePath);
    if (actualTarget.platform !== 'win32' || actualTarget.architecture !== architecture) {
      throw new Error(
        `Windows VC runtime target mismatch: expected win32/${architecture}, `
        + `got ${actualTarget.platform}/${actualTarget.architecture}: ${sourcePath}`,
      );
    }
    verifySourceFile(sourcePath);
  }

  // 同一发布包不能混用两版 CRT；全部来源验真后再重建一次性构建暂存目录。
  fs.rmSync(targetDirectory, { recursive: true, force: true });
  fs.mkdirSync(targetDirectory, { recursive: true });
  for (const fileName of runtimeFiles) {
    fs.copyFileSync(path.join(sourceDirectory, fileName), path.join(targetDirectory, fileName));
  }
  return runtimeFiles;
}

function assertWindowsVcRuntimeAuthenticode({ filePath, status, subject }) {
  if (status !== 'Valid') {
    throw new Error(`Windows VC runtime Authenticode signature is not valid (${status}): ${filePath}`);
  }
  if (typeof subject !== 'string' || !/^CN=Microsoft Corporation(?:,|$)/.test(subject)) {
    throw new Error(`Windows VC runtime signer is not Microsoft Corporation: ${filePath}`);
  }
}

function parseNapiPrebuildDirectoryName(directoryName) {
  const match = /^((?:node|electron)-v\d+)-napi-v(\d+)-(darwin|win32|linux)-(arm64|x64)-([^-]+)-(.+)$/.exec(directoryName);
  if (!match) return null;
  return {
    runtimeAbi: match[1],
    napiVersion: Number.parseInt(match[2], 10),
    platform: match[3],
    architecture: match[4],
    libc: match[5],
    libcVersion: match[6],
  };
}

function selectCompatibleNapiArtifact({
  prebuildDirectory,
  napiVersion,
  targetPlatform,
  targetArchitecture,
  moduleFileName,
}) {
  assertSupportedNativeTarget(targetPlatform, targetArchitecture);
  if (!Number.isInteger(napiVersion) || napiVersion < 1) {
    throw new Error(`N-API version must be a positive integer, got ${napiVersion}`);
  }
  const candidates = fs.readdirSync(prebuildDirectory, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => ({ entry, parsed: parseNapiPrebuildDirectoryName(entry.name) }))
    .filter(candidate => (
      candidate.parsed?.napiVersion === napiVersion
      && candidate.parsed.platform === targetPlatform
      && candidate.parsed.architecture === targetArchitecture
    ))
    .sort((left, right) => left.entry.name.localeCompare(right.entry.name));
  if (candidates.length === 0) {
    throw new Error(
      `No N-API v${napiVersion} artifact for ${targetPlatform}/${targetArchitecture} in ${prebuildDirectory}`,
    );
  }
  // N-API 是兼容边界，Node/Electron ABI 目录只负责让各自的加载器找到同一制品。
  // 验真全部同目标候选，防止错误命名的二进制被目录排序掩盖。
  for (const candidate of candidates) {
    const filePath = path.join(prebuildDirectory, candidate.entry.name, moduleFileName);
    const actualTarget = inspectNativeBinaryTarget(filePath);
    if (actualTarget.platform !== targetPlatform || actualTarget.architecture !== targetArchitecture) {
      throw new Error(
        `Native artifact target mismatch: expected ${targetPlatform}/${targetArchitecture}, `
        + `got ${actualTarget.platform}/${actualTarget.architecture}: ${filePath}`,
      );
    }
  }
  return path.join(prebuildDirectory, candidates[0].entry.name, moduleFileName);
}

function buildElectronBuilderArguments({
  platform,
  architecture,
  adHocMacSigning,
  macSigningIdentity,
}) {
  if (!SUPPORTED_PACKAGE_BUILD_TARGETS.has(`${platform}:${architecture}`)) {
    throw new Error(`Unsupported Electron package target: ${platform}/${architecture}`);
  }
  const argumentsList = [
    'exec',
    'electron-builder',
    '--projectDir',
    'dist_build',
    platform === 'darwin' ? '--mac' : '--win',
    `--${architecture}`,
    // 原生模块已由生产脚本按 Electron 目标准备并验真；再次 rebuild 会修改冻结后的
    // 发布树，还会让 node-pre-gyp 重新依赖外网。
    '--config.npmRebuild=false',
  ];
  if (adHocMacSigning) {
    if (platform !== 'darwin') {
      throw new Error('Ad-hoc macOS signing can only be used for a macOS build');
    }
    // electron-builder 26 用 identity="-" 表示 ad-hoc；osx-sign 用字符串 none 关闭时间戳。
    // 布尔 false 会被拼成 codesign 不接受的 --timestamp=false。
    argumentsList.push('--config.mac.identity=-', '--config.mac.timestamp=none');
  } else if (platform === 'darwin') {
    if (!macSigningIdentity || macSigningIdentity === '-') {
      throw new Error('Formal macOS builds require a non-ad-hoc signing identity');
    }
    argumentsList.push(`--config.mac.identity=${macSigningIdentity}`);
  }
  return argumentsList;
}

module.exports = {
  assertWindowsVcRuntimeAuthenticode,
  buildElectronBuilderArguments,
  inspectNativeBinaryTarget,
  parseNapiPrebuildDirectoryName,
  prepareWindowsAppLocalRuntime,
  resolveWindowsReleaseCommandRuntimeEnvironment,
  resolveWindowsVcRuntimeSource,
  selectCompatibleNapiArtifact,
  WINDOWS_VC_RUNTIME_SOURCE_ENV_NAME,
  WINDOWS_COMMAND_RUNTIME_BUILD_TRUST_ENV_NAME,
  WINDOWS_EXPECTED_PUBLISHER_IDENTITY_ENV_NAME,
};
