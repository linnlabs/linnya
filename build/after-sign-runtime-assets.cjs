const { spawn } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

const HEADLESS_NODE_RUNTIME_CATALOG = require('../config/headless-node-runtime.json');

const ARTIFACT_FILE_NAME = 'linnyaCommandProcessOwner.node';
const MANIFEST_FILE_NAME = 'linnyaCommandProcessOwner.manifest.json';
const SUPPORTED_ARCHITECTURES = new Set(['x64', 'arm64']);
const BUILD_TRUST_ENV_NAME = 'LINNYA_WINDOWS_COMMAND_RUNTIME_BUILD_TRUST';
const EXPECTED_PUBLISHER_ENV_NAME = 'LINNYA_WINDOWS_EXPECTED_PUBLISHER_IDENTITY';
const EXPECTED_NODE_PTY_VERSION = '1.2.0-beta.14';
const WINDOWS_VC_RUNTIME_REQUIRED_FILES = [
  'msvcp140.dll',
  'vcruntime140.dll',
  'vcruntime140_1.dll',
];
const WINDOWS_VC_RUNTIME_TARGET_DIRECTORIES = [
  '.',
  'resources/command-runtime/windows/x64',
  'resources/bin/qdrant',
];
const MACOS_ARCHITECTURES = new Map([
  [1, 'x64'],
  [3, 'arm64'],
  ['x64', 'x64'],
  ['arm64', 'arm64'],
]);
const MACOS_NODE_PTY_TOP_LEVEL_ENTRIES = ['LICENSE', 'lib', 'package.json', 'prebuilds'];
const MACOS_NODE_PTY_REQUIRED_JAVASCRIPT = [
  'eventEmitter2.js',
  'index.js',
  'interfaces.js',
  'terminal.js',
  'types.js',
  'unixTerminal.js',
  'utils.js',
];
const SANDBOX_EVALUATOR_BUNDLE_RELATIVE_PATH =
  'resources/sandbox-runtime/evaluator/sandboxEvaluatorProcess.cjs';

function resolveHeadlessNodeRuntimeTarget(platform, architecture) {
  if (
    HEADLESS_NODE_RUNTIME_CATALOG?.schema_version !== 1
    || HEADLESS_NODE_RUNTIME_CATALOG?.runtime_id !== 'linnya_headless_node_runtime'
    || typeof HEADLESS_NODE_RUNTIME_CATALOG?.node_version !== 'string'
    || !Array.isArray(HEADLESS_NODE_RUNTIME_CATALOG?.targets)
  ) {
    throw new Error('Headless Node runtime catalog is invalid');
  }
  const target = HEADLESS_NODE_RUNTIME_CATALOG.targets.find(candidate => (
    candidate?.platform === platform && candidate?.architecture === architecture
  ));
  if (!target) throw new Error(`Headless Node runtime target is missing: ${platform}/${architecture}`);
  if (
    typeof target.archive_file_name !== 'string'
    || typeof target.archive_sha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(target.archive_sha256)
    || typeof target.executable_relative_path !== 'string'
  ) {
    throw new Error(`Headless Node runtime target is invalid: ${platform}/${architecture}`);
  }
  return target;
}

async function readPackagedHeadlessNodeRuntime(appResourcesDirectory, platform, architecture) {
  const target = resolveHeadlessNodeRuntimeTarget(platform, architecture);
  const runtimeDirectory = path.join(
    appResourcesDirectory,
    'headless-node-runtime',
    platform,
    architecture,
  );
  const manifestPath = path.join(runtimeDirectory, 'runtime-manifest.json');
  const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  if (
    manifest?.schema_version !== 1
    || manifest?.runtime_id !== 'linnya_headless_node_runtime'
    || manifest?.node_version !== HEADLESS_NODE_RUNTIME_CATALOG.node_version
    || manifest?.platform !== platform
    || manifest?.architecture !== architecture
    || manifest?.distribution?.archive_file_name !== target.archive_file_name
    || manifest?.distribution?.archive_sha256 !== target.archive_sha256
    || manifest?.prepared_executable?.relative_path !== target.executable_relative_path
    || typeof manifest?.prepared_executable?.size_bytes !== 'number'
    || manifest.prepared_executable.size_bytes <= 0
    || !/^[a-f0-9]{64}$/.test(manifest?.prepared_executable?.sha256 ?? '')
  ) {
    throw new Error(`Packaged Headless Node runtime manifest is invalid: ${manifestPath}`);
  }
  const executablePath = path.join(runtimeDirectory, target.executable_relative_path);
  const licensePath = path.join(runtimeDirectory, 'LICENSE');
  const evaluatorPath = path.join(
    appResourcesDirectory,
    SANDBOX_EVALUATOR_BUNDLE_RELATIVE_PATH.replace(/^resources\//, ''),
  );
  const [executableStat, licenseStat, evaluatorStat] = await Promise.all([
    fsp.stat(executablePath),
    fsp.stat(licensePath),
    fsp.stat(evaluatorPath),
  ]);
  if (!executableStat.isFile() || executableStat.size <= 0) {
    throw new Error(`Packaged Headless Node executable is invalid: ${executablePath}`);
  }
  if (!licenseStat.isFile() || licenseStat.size <= 0) {
    throw new Error(`Packaged Headless Node LICENSE is invalid: ${licensePath}`);
  }
  if (!evaluatorStat.isFile() || evaluatorStat.size <= 0) {
    throw new Error(`Packaged Sandbox evaluator bundle is invalid: ${evaluatorPath}`);
  }
  return { executablePath, evaluatorPath };
}

function runExecutable(executablePath, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(
        `${label} exited with code ${code ?? 'unknown'}: ${stderr.trim()}`,
      ));
    });
  });
}

async function inspectMacCodeSignature(filePath, deep = false) {
  await runExecutable(
    '/usr/bin/codesign',
    ['--verify', '--strict', ...(deep ? ['--deep'] : []), filePath],
    `codesign verification for ${filePath}`,
  );
  const display = await runExecutable(
    '/usr/bin/codesign',
    ['--display', '--verbose=4', filePath],
    `codesign inspection for ${filePath}`,
  );
  const teamMatch = display.stderr.match(/^TeamIdentifier=(.+)$/m);
  if (!teamMatch) {
    throw new Error(`codesign did not report TeamIdentifier for ${filePath}`);
  }
  return {
    teamIdentifier: teamMatch[1] === 'not set' ? null : teamMatch[1],
  };
}

async function inspectMacArchitectures(filePath) {
  const result = await runExecutable(
    '/usr/bin/lipo',
    ['-archs', filePath],
    `architecture inspection for ${filePath}`,
  );
  return result.stdout.trim().split(/\s+/).filter(Boolean);
}

function runPowerShell(source, env) {
  return new Promise((resolve, reject) => {
    const systemRoot = process.env.SystemRoot;
    if (!systemRoot || !path.isAbsolute(systemRoot)) {
      reject(new Error('SystemRoot is required to locate Windows PowerShell'));
      return;
    }
    const powershellPath = path.join(
      systemRoot,
      'System32/WindowsPowerShell/v1.0/powershell.exe',
    );
    const childEnvironment = { ...process.env, ...env };
    delete childEnvironment.PSModulePath;
    delete childEnvironment.PSMODULEPATH;
    const child = spawn(powershellPath, [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      source,
    ], {
      env: childEnvironment,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(
        `Authenticode inspection exited with code ${code ?? 'unknown'}: ${stderr.trim()}`,
      ));
    });
  });
}

function readRequiredString(record, key, label) {
  const value = record?.[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

async function inspectAuthenticode(artifactPath) {
  const source = [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    "$securityModule = Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1'",
    'Import-Module -Name $securityModule -Force -ErrorAction Stop',
    '$signature = Microsoft.PowerShell.Security\\Get-AuthenticodeSignature -LiteralPath $env:LINNYA_NATIVE_ARTIFACT_PATH',
    '[pscustomobject]@{',
    '  status = [string]$signature.Status',
    '  status_message = [string]$signature.StatusMessage',
    '  publisher_identity = if ($null -eq $signature.SignerCertificate) { $null } else { [string]$signature.SignerCertificate.Subject }',
    '} | ConvertTo-Json -Compress',
  ].join('\n');
  const result = JSON.parse(await runPowerShell(source, {
    LINNYA_NATIVE_ARTIFACT_PATH: artifactPath,
  }));
  if (
    !result
    || typeof result !== 'object'
    || typeof result.status !== 'string'
    || typeof result.status_message !== 'string'
    || (
      result.publisher_identity !== null
      && typeof result.publisher_identity !== 'string'
    )
  ) {
    throw new Error('Windows command native Authenticode result is invalid');
  }
  return result;
}

async function writeJsonAtomically(filePath, value) {
  const temporaryPath = `${filePath}.pending-${process.pid}-${randomUUID()}`;
  await fsp.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  await fsp.rename(temporaryPath, filePath);
}

function readBuildTrust(environment) {
  const mode = environment[BUILD_TRUST_ENV_NAME];
  if (mode === 'development') return Object.freeze({ kind: 'development' });
  if (mode === 'release') {
    const expectedPublisherIdentity = environment[EXPECTED_PUBLISHER_ENV_NAME];
    if (!expectedPublisherIdentity) {
      throw new Error(
        `${EXPECTED_PUBLISHER_ENV_NAME} is required for a release Windows build`,
      );
    }
    return Object.freeze({ kind: 'release', expectedPublisherIdentity });
  }
  throw new Error(
    `${BUILD_TRUST_ENV_NAME} must be explicitly set to development or release`,
  );
}

async function readPreSignRuntime(runtimeDirectory, architecture, applicationVersion) {
  const artifactPath = path.join(runtimeDirectory, ARTIFACT_FILE_NAME);
  const manifestPath = path.join(runtimeDirectory, MANIFEST_FILE_NAME);
  const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  if (
    manifest?.schema_version !== 1
    || manifest?.runtime_id !== 'linnya_command_process_owner'
    || manifest?.platform !== 'win32'
    || manifest?.architecture !== architecture
    || manifest?.application_version !== applicationVersion
    || manifest?.minimum_node_api_version !== 8
    || manifest?.binding_contract_version !== 1
    || manifest?.signature_evidence?.kind !== 'development_unsigned'
    || manifest?.artifact?.file_name !== ARTIFACT_FILE_NAME
  ) {
    throw new Error(`Windows command native pre-sign manifest is invalid: ${manifestPath}`);
  }
  readRequiredString(manifest, 'runtime_version', 'Windows command native runtime version');

  const artifactStat = await fsp.stat(artifactPath);
  if (!artifactStat.isFile() || artifactStat.size <= 0) {
    throw new Error(`Windows command native artifact is not a regular non-empty file: ${artifactPath}`);
  }
  return {
    artifactPath,
    manifestPath,
    manifest,
    artifactBytes: await fsp.readFile(artifactPath),
  };
}

async function finalizeRuntimeDirectory(
  runtimeDirectory,
  architecture,
  applicationVersion,
  buildTrust,
  authenticodeInspector,
) {
  const runtime = await readPreSignRuntime(
    runtimeDirectory,
    architecture,
    applicationVersion,
  );
  const authenticode = await authenticodeInspector(runtime.artifactPath);

  if (buildTrust.kind === 'development') {
    if (
      authenticode.status !== 'NotSigned'
      || authenticode.publisher_identity !== null
    ) {
      throw new Error(
        'Development Windows command runtime must remain unsigned: '
          + `status=${authenticode.status} publisher=${String(authenticode.publisher_identity)}`,
      );
    }
    const artifactHash = createHash('sha256')
      .update(runtime.artifactBytes)
      .digest('hex');
    if (
      runtime.manifest.artifact.size_bytes !== runtime.artifactBytes.byteLength
      || runtime.manifest.artifact.sha256 !== artifactHash
    ) {
      throw new Error(
        'Development Windows command runtime changed after its manifest was generated',
      );
    }
    return;
  }

  if (authenticode.status !== 'Valid') {
    throw new Error(
      `Windows command native Authenticode status is ${authenticode.status}: `
        + authenticode.status_message,
    );
  }
  if (authenticode.publisher_identity !== buildTrust.expectedPublisherIdentity) {
    throw new Error(
      'Windows command native Authenticode publisher mismatch: '
        + `expected=${buildTrust.expectedPublisherIdentity} `
        + `actual=${String(authenticode.publisher_identity)}`,
    );
  }

  // Authenticode 会修改 .node 的 byte；最终 hash 必须在验签之后生成。
  // manifest 记录的是发布管线事实，运行时 loader 只复核这些 byte 未被替换。
  await writeJsonAtomically(runtime.manifestPath, {
    ...runtime.manifest,
    signature_evidence: {
      kind: 'authenticode_build_verified',
      publisher_identity: buildTrust.expectedPublisherIdentity,
    },
    artifact: {
      file_name: ARTIFACT_FILE_NAME,
      size_bytes: runtime.artifactBytes.byteLength,
      sha256: createHash('sha256').update(runtime.artifactBytes).digest('hex'),
    },
  });
}

async function assertPackagedWindowsVcRuntime(appOutDir, authenticodeInspector) {
  const referenceDirectory = path.join(
    appOutDir,
    'resources/command-runtime/windows/x64',
  );
  const runtimeFileNames = (await fsp.readdir(referenceDirectory, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.dll'))
    .map(entry => entry.name)
    .sort();
  const lowerCaseFileNames = new Set(runtimeFileNames.map(fileName => fileName.toLowerCase()));
  for (const requiredFileName of WINDOWS_VC_RUNTIME_REQUIRED_FILES) {
    if (!lowerCaseFileNames.has(requiredFileName)) {
      throw new Error(`Packaged Windows VC runtime is missing ${requiredFileName}`);
    }
  }

  const referenceHashes = new Map();
  for (const fileName of runtimeFileNames) {
    const filePath = path.join(referenceDirectory, fileName);
    const bytes = await fsp.readFile(filePath);
    const signature = await authenticodeInspector(filePath);
    if (
      signature.status !== 'Valid'
      || !/^CN=Microsoft Corporation(?:,|$)/.test(signature.publisher_identity ?? '')
    ) {
      throw new Error(`Packaged Windows VC runtime has invalid Microsoft signature: ${filePath}`);
    }
    referenceHashes.set(fileName, createHash('sha256').update(bytes).digest('hex'));
  }

  for (const relativeDirectory of WINDOWS_VC_RUNTIME_TARGET_DIRECTORIES) {
    const targetDirectory = path.resolve(appOutDir, relativeDirectory);
    for (const [fileName, expectedHash] of referenceHashes) {
      const targetPath = path.join(targetDirectory, fileName);
      const bytes = await fsp.readFile(targetPath);
      const actualHash = createHash('sha256').update(bytes).digest('hex');
      if (actualHash !== expectedHash) {
        throw new Error(`Packaged Windows VC runtime differs between load locations: ${targetPath}`);
      }
    }
  }
}

async function assertMacNodePtyRuntime(
  context,
  codeSignatureInspector,
  architectureInspector,
) {
  const architecture = MACOS_ARCHITECTURES.get(context.arch);
  if (!architecture) {
    throw new Error(`Unsupported macOS package architecture: ${String(context.arch)}`);
  }
  const productFilename = readRequiredString(
    context.packager?.appInfo,
    'productFilename',
    'electron-builder product filename',
  );
  const appPath = path.join(context.appOutDir, `${productFilename}.app`);
  const nodePtyRoot = path.join(
    appPath,
    'Contents/Resources/app.asar.unpacked/node_modules/node-pty',
  );
  const packageJson = JSON.parse(await fsp.readFile(
    path.join(nodePtyRoot, 'package.json'),
    'utf8',
  ));
  if (
    packageJson?.name !== 'node-pty'
    || packageJson?.version !== EXPECTED_NODE_PTY_VERSION
    || packageJson?.license !== 'MIT'
  ) {
    throw new Error(
      `Packaged node-pty must be exactly node-pty@${EXPECTED_NODE_PTY_VERSION} with MIT license`,
    );
  }
  const topLevelEntries = (await fsp.readdir(nodePtyRoot)).sort();
  if (topLevelEntries.join('\n') !== MACOS_NODE_PTY_TOP_LEVEL_ENTRIES.join('\n')) {
    throw new Error('Packaged node-pty contains an unexpected top-level runtime entry');
  }
  const licensePath = path.join(nodePtyRoot, 'LICENSE');
  const targetPrebuildRoot = path.join(nodePtyRoot, 'prebuilds', `darwin-${architecture}`);
  const addonPath = path.join(targetPrebuildRoot, 'pty.node');
  const helperPath = path.join(targetPrebuildRoot, 'spawn-helper');
  const [licenseStat, addonStat, helperStat] = await Promise.all([
    fsp.stat(licensePath),
    fsp.stat(addonPath),
    fsp.stat(helperPath),
  ]);
  await Promise.all(MACOS_NODE_PTY_REQUIRED_JAVASCRIPT.map(async fileName => {
    const filePath = path.join(nodePtyRoot, 'lib', fileName);
    const stat = await fsp.stat(filePath);
    if (!stat.isFile() || stat.size === 0) {
      throw new Error(`Packaged node-pty runtime JavaScript is missing: ${filePath}`);
    }
  }));
  if (!licenseStat.isFile() || licenseStat.size === 0) {
    throw new Error(`Packaged node-pty LICENSE is missing or empty: ${licensePath}`);
  }
  if (!addonStat.isFile() || addonStat.size === 0 || (addonStat.mode & 0o111) !== 0) {
    throw new Error(`Packaged node-pty pty.node has invalid type or permissions: ${addonPath}`);
  }
  if (!helperStat.isFile() || helperStat.size === 0 || (helperStat.mode & 0o111) === 0) {
    throw new Error(`Packaged node-pty spawn-helper is not an executable file: ${helperPath}`);
  }

  const prebuildDirectories = await fsp.readdir(path.join(nodePtyRoot, 'prebuilds'));
  if (prebuildDirectories.length !== 1 || prebuildDirectories[0] !== `darwin-${architecture}`) {
    throw new Error('Packaged node-pty contains a non-target prebuild directory');
  }
  const nativeEntries = (await fsp.readdir(targetPrebuildRoot)).sort();
  if (nativeEntries.join('\n') !== ['pty.node', 'spawn-helper'].join('\n')) {
    throw new Error('Packaged node-pty contains an unexpected target native file');
  }

  for (const nativePath of [addonPath, helperPath]) {
    const architectures = await architectureInspector(nativePath);
    if (architectures.length !== 1 || architectures[0] !== architecture) {
      throw new Error(
        `Packaged node-pty native architecture mismatch: expected ${architecture}, got ${architectures.join(',')}`,
      );
    }
  }

  const [appSignature, addonSignature, helperSignature] = await Promise.all([
    codeSignatureInspector(appPath, true),
    codeSignatureInspector(addonPath, false),
    codeSignatureInspector(helperPath, false),
  ]);
  for (const [label, signature] of [
    ['pty.node', addonSignature],
    ['spawn-helper', helperSignature],
  ]) {
    if (signature.teamIdentifier !== appSignature.teamIdentifier) {
      throw new Error(
        `Packaged node-pty ${label} TeamIdentifier does not match the application`,
      );
    }
  }
}

async function assertMacSandboxEvaluatorRuntime(
  context,
  codeSignatureInspector,
  architectureInspector,
) {
  const architecture = MACOS_ARCHITECTURES.get(context.arch);
  if (!architecture) {
    throw new Error(`Unsupported macOS package architecture: ${String(context.arch)}`);
  }
  const productFilename = readRequiredString(
    context.packager?.appInfo,
    'productFilename',
    'electron-builder product filename',
  );
  const appPath = path.join(context.appOutDir, `${productFilename}.app`);
  const resourcesDirectory = path.join(appPath, 'Contents/Resources');
  const runtime = await readPackagedHeadlessNodeRuntime(
    resourcesDirectory,
    'darwin',
    architecture,
  );
  const executableStat = await fsp.stat(runtime.executablePath);
  if ((executableStat.mode & 0o111) === 0) {
    throw new Error('Packaged Headless Node executable is not executable');
  }
  const architectures = await architectureInspector(runtime.executablePath);
  if (architectures.length !== 1 || architectures[0] !== architecture) {
    throw new Error(
      `Packaged Headless Node architecture mismatch: expected ${architecture}, `
      + `got ${architectures.join(',')}`,
    );
  }
  const [appSignature, nodeSignature] = await Promise.all([
    codeSignatureInspector(appPath, true),
    codeSignatureInspector(runtime.executablePath, false),
  ]);
  if (nodeSignature.teamIdentifier !== appSignature.teamIdentifier) {
    throw new Error('Packaged Headless Node TeamIdentifier does not match the application');
  }
}

async function assertWindowsSandboxEvaluatorRuntime(appOutDir, authenticodeInspector) {
  const runtime = await readPackagedHeadlessNodeRuntime(
    path.join(appOutDir, 'resources'),
    'win32',
    'x64',
  );
  const signature = await authenticodeInspector(runtime.executablePath);
  if (signature.status !== 'Valid' || !signature.publisher_identity) {
    throw new Error(
      `Packaged Headless Node Authenticode is invalid: ${signature.status} `
      + `${signature.status_message}`,
    );
  }
}

function createAfterSignRuntimeAssetsHook({
  hostPlatform = process.platform,
  environment = process.env,
  authenticodeInspector = inspectAuthenticode,
  windowsVcRuntimeAuthenticodeInspector = inspectAuthenticode,
  macCodeSignatureInspector = inspectMacCodeSignature,
  macArchitectureInspector = inspectMacArchitectures,
} = {}) {
  // electron-builder 即使没有签名证书也可能触发 afterSign，因此信任模式必须由
  // 打包入口明确声明，不能根据 hook 是否被调用来猜测。
  const configuredTrustMode = environment[BUILD_TRUST_ENV_NAME];
  const configuredPublisherIdentity = environment[EXPECTED_PUBLISHER_ENV_NAME];
  return async function afterSignRuntimeAssets(context) {
    if (context.electronPlatformName === 'darwin') {
      if (hostPlatform !== 'darwin') {
        throw new Error('macOS node-pty signing evidence must be finalized on macOS');
      }
      await assertMacNodePtyRuntime(
        context,
        macCodeSignatureInspector,
        macArchitectureInspector,
      );
      await assertMacSandboxEvaluatorRuntime(
        context,
        macCodeSignatureInspector,
        macArchitectureInspector,
      );
      return;
    }
    if (context.electronPlatformName !== 'win32') return;
    if (hostPlatform !== 'win32') {
      throw new Error(
        'Windows command runtime signing evidence must be finalized on Windows',
      );
    }
    const buildTrust = readBuildTrust({
      [BUILD_TRUST_ENV_NAME]: configuredTrustMode,
      [EXPECTED_PUBLISHER_ENV_NAME]: configuredPublisherIdentity,
    });
    const applicationVersion = readRequiredString(
      context.packager?.appInfo,
      'version',
      'electron-builder application version',
    );
    await assertPackagedWindowsVcRuntime(
      context.appOutDir,
      windowsVcRuntimeAuthenticodeInspector,
    );
    await assertWindowsSandboxEvaluatorRuntime(
      context.appOutDir,
      windowsVcRuntimeAuthenticodeInspector,
    );
    const runtimeRoot = path.join(
      context.appOutDir,
      'resources/command-runtime/windows',
    );
    const entries = await fsp.readdir(runtimeRoot, { withFileTypes: true });
    const architectureDirectories = entries.filter(entry => entry.isDirectory());
    if (architectureDirectories.length === 0) {
      throw new Error('Windows package does not contain a command native runtime');
    }
    for (const entry of architectureDirectories) {
      if (!SUPPORTED_ARCHITECTURES.has(entry.name)) {
        throw new Error(`Unsupported packaged Windows command runtime architecture: ${entry.name}`);
      }
      await finalizeRuntimeDirectory(
        path.join(runtimeRoot, entry.name),
        entry.name,
        applicationVersion,
        buildTrust,
        authenticodeInspector,
      );
    }
  };
}

module.exports = createAfterSignRuntimeAssetsHook();
module.exports.createAfterSignRuntimeAssetsHook = createAfterSignRuntimeAssetsHook;
