import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import { createIsolatedRunRoot } from './harness/isolatedRunRoot.mjs';
import { expectedElectronVersion } from './harness/electronRuntimeIdentity.mjs';

const fixtureDirectory = fileURLToPath(
  new URL('./fixtures/pty-dependency-capability/', import.meta.url),
);
const windowsControllerPath = fileURLToPath(
  new URL('./pty-dependency-capability.e2e.ps1', import.meta.url),
);
const repositoryRoot = path.resolve(fixtureDirectory, '../../../../..');
const electronPath = path.join(
  repositoryRoot,
  'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
);
const requestedPlatform = process.argv.find(argument => argument.startsWith('--platform='))
  ?.slice('--platform='.length) ?? 'macos';
const sshHost = process.env.LINNYA_WINDOWS_SSH_HOST;
const sshUser = process.env.LINNYA_WINDOWS_SSH_USER;
const sshKey = process.env.LINNYA_WINDOWS_SSH_KEY;
const windowsNodeArm64Path = process.env.LINNYA_WINDOWS_NODE_ARM64_PATH
  ?? `C:/Users/${sshUser}/AppData/Local/Temp/linnya-napi-spike/node-v24.18.0-win-arm64/node.exe`;
const windowsNodeX64Path = process.env.LINNYA_WINDOWS_NODE_X64_PATH
  ?? `C:/Users/${sshUser}/AppData/Local/Temp/linnya-napi-spike/node-v24.18.0-win-x64/node.exe`;
const OUTPUT_LIMIT = 512 * 1024;

const packages = [
  {
    spec: 'node-pty@1.2.0-beta.14',
    archiveName: 'node-pty-1.2.0-beta.14.tgz',
    sha256: '1c00a3190b95ac1639f39215d792366fd9cf91265e41a55fab152b65346baef0',
  },
  {
    spec: 'node-addon-api@7.1.1',
    archiveName: 'node-addon-api-7.1.1.tgz',
    sha256: 'b10455d15a977c0cd17a1cb0eb679e03d939f8ef8d4302eb33e1f78dacc71f82',
  },
  {
    spec: '@xterm/headless@6.0.0',
    archiveName: 'xterm-headless-6.0.0.tgz',
    sha256: '07e4970b1674e7ef6cbd57c8c17746eaadcd41aa7df5b33695fd649e6ec4d78a',
  },
];

if (process.platform !== 'darwin') {
  throw new Error('PTY dependency capability E2E must be controlled from macOS');
}
if (!['macos', 'windows', 'all'].includes(requestedPlatform)) {
  throw new Error(`unsupported --platform value: ${requestedPlatform}`);
}
if (requestedPlatform !== 'macos' && (
  !sshHost || !sshUser || !sshKey || !path.isAbsolute(sshKey)
)) {
  throw new Error(
    'Windows E2E requires LINNYA_WINDOWS_SSH_HOST, LINNYA_WINDOWS_SSH_USER, '
      + 'and absolute LINNYA_WINDOWS_SSH_KEY',
  );
}

function appendBounded(current, chunk) {
  return `${current}${chunk.toString('utf8')}`.slice(-OUTPUT_LIMIT);
}

function run(file, args, {
  cwd = repositoryRoot,
  env = process.env,
  timeoutMs = 120_000,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      env,
      detached: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (error?.code !== 'ESRCH') reject(error);
      }
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout = appendBounded(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = appendBounded(stderr, chunk); });
    child.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`${file} exceeded ${timeoutMs}ms; stderr=${stderr}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(
          `${file} failed: code=${code ?? 'unknown'} signal=${signal ?? 'none'} `
            + `stderr=${stderr} stdout=${stdout}`,
        ));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function sha256(filePath) {
  return createHash('sha256').update(await fsp.readFile(filePath)).digest('hex');
}

async function prepareDependencies(isolatedRoot) {
  const packageRoot = path.join(isolatedRoot, 'packages');
  const projectRoot = path.join(isolatedRoot, 'validation-project');
  await Promise.all([
    fsp.mkdir(packageRoot, { recursive: true }),
    fsp.mkdir(projectRoot, { recursive: true }),
  ]);
  await fsp.writeFile(
    path.join(projectRoot, 'package.json'),
    `${JSON.stringify({ private: true, name: 'linnya-pty-dependency-validation' }, null, 2)}\n`,
  );
  for (const packageIdentity of packages) {
    await run('npm', [
      'pack',
      '--silent',
      packageIdentity.spec,
      '--pack-destination',
      packageRoot,
    ]);
    const archivePath = path.join(packageRoot, packageIdentity.archiveName);
    assert.equal(await sha256(archivePath), packageIdentity.sha256);
  }
  await run('npm', [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--no-package-lock',
    '--no-save',
    ...packages.map(packageIdentity => path.join(packageRoot, packageIdentity.archiveName)),
  ], { cwd: projectRoot });
  const moduleRoot = path.join(projectRoot, 'node_modules');
  const [nodePtyPackage, xtermPackage, nodeAddonApiPackage] = await Promise.all([
    fsp.readFile(path.join(moduleRoot, 'node-pty/package.json'), 'utf8').then(JSON.parse),
    fsp.readFile(path.join(moduleRoot, '@xterm/headless/package.json'), 'utf8').then(JSON.parse),
    fsp.readFile(path.join(moduleRoot, 'node-addon-api/package.json'), 'utf8').then(JSON.parse),
  ]);
  assert.equal(nodePtyPackage.version, '1.2.0-beta.14');
  assert.equal(nodePtyPackage.license, 'MIT');
  assert.equal(xtermPackage.version, '6.0.0');
  assert.equal(xtermPackage.license, 'MIT');
  assert.equal(nodeAddonApiPackage.version, '7.1.1');
  const helperMode = (await fsp.stat(
    path.join(moduleRoot, 'node-pty/prebuilds/darwin-arm64/spawn-helper'),
  )).mode;
  assert.notEqual(helperMode & 0o111, 0, 'macOS spawn-helper lost its executable bit');
  return {
    moduleRoot,
    projectRoot,
    packageFacts: {
      nodePty: { version: nodePtyPackage.version, license: nodePtyPackage.license },
      xtermHeadless: { version: xtermPackage.version, license: xtermPackage.license },
      nodeAddonApi: { version: nodeAddonApiPackage.version, license: nodeAddonApiPackage.license },
      archives: packages.map(packageIdentity => ({
        name: packageIdentity.archiveName,
        sha256: packageIdentity.sha256,
      })),
    },
  };
}

async function runSuite(executable, runtimeKind, moduleRoot, resultPath, extraEnv = {}) {
  const suitePath = path.join(fixtureDirectory, 'validation-suite.cjs');
  const result = await run(executable, [suitePath], {
    env: {
      ...process.env,
      ...extraEnv,
      LINNYA_PTY_VALIDATION_MODULE_ROOT: moduleRoot,
      LINNYA_PTY_VALIDATION_RESULT_PATH: resultPath,
      LINNYA_PTY_VALIDATION_RUNTIME_KIND: runtimeKind,
    },
  });
  const parsed = JSON.parse(await fsp.readFile(resultPath, 'utf8'));
  assert.equal(parsed.success, true, result.stderr || result.stdout);
  assert.equal(parsed.runtime.kind, runtimeKind);
  return parsed;
}

async function runMacValidation(moduleRoot, isolatedRoot) {
  const node = await runSuite(
    process.execPath,
    'node',
    moduleRoot,
    path.join(isolatedRoot, 'macos-node-result.json'),
  );
  const electron = await runSuite(
    electronPath,
    'electron-run-as-node',
    moduleRoot,
    path.join(isolatedRoot, 'macos-electron-result.json'),
    { ELECTRON_RUN_AS_NODE: '1' },
  );
  assert.equal(node.runtime.architecture, 'arm64');
  assert.equal(electron.runtime.electron, expectedElectronVersion);
  assert.equal(node.transcript.exactPayloadPreserved, true);
  assert.equal(electron.transcript.exactPayloadPreserved, true);
  return { node, electron };
}

async function removeRemoteFiles(sshArgs, sshTarget, remotePaths) {
  const source = remotePaths
    .map(remotePath => `Remove-Item -LiteralPath '${remotePath.replaceAll("'", "''")}' -Force -ErrorAction SilentlyContinue`)
    .join('; ');
  await run('ssh', [
    ...sshArgs,
    sshTarget,
    'powershell',
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    source,
  ]);
}

async function runWindowsValidation(moduleRoot, isolatedRoot) {
  const stagingRoot = path.join(isolatedRoot, 'windows-staging');
  const stagingValidation = path.join(stagingRoot, 'validation');
  await Promise.all([
    fsp.cp(moduleRoot, path.join(stagingValidation, 'node_modules'), { recursive: true }),
    fsp.cp(fixtureDirectory, path.join(stagingValidation, 'fixture'), { recursive: true }),
  ]);
  const token = randomUUID().replaceAll('-', '');
  const archivePath = path.join(isolatedRoot, `pty-validation-${token}.tar.gz`);
  await run('tar', ['-czf', archivePath, '-C', stagingRoot, 'validation']);
  const sshTarget = `${sshUser}@${sshHost}`;
  const sshArgs = ['-i', sshKey, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8'];
  const remoteArchive = `C:/Users/${sshUser}/AppData/Local/Temp/linnya-pty-validation-${token}.tar.gz`;
  const remoteController = `C:/Users/${sshUser}/AppData/Local/Temp/linnya-pty-validation-${token}.ps1`;
  try {
    await run('scp', [
      ...sshArgs,
      archivePath,
      `${sshTarget}:/C:/Users/${sshUser}/AppData/Local/Temp/linnya-pty-validation-${token}.tar.gz`,
    ]);
    await run('scp', [
      ...sshArgs,
      windowsControllerPath,
      `${sshTarget}:/C:/Users/${sshUser}/AppData/Local/Temp/linnya-pty-validation-${token}.ps1`,
    ]);
    const remote = await run('ssh', [
      ...sshArgs,
      sshTarget,
      'powershell',
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      remoteController,
      '-ArchivePath',
      remoteArchive,
      '-NodeArm64Path',
      windowsNodeArm64Path,
      '-NodeX64Path',
      windowsNodeX64Path,
    ], { timeoutMs: 180_000 });
    const parsed = JSON.parse(remote.stdout.trim().split(/\r?\n/u).at(-1));
    assert.equal(parsed.success, true);
    assert.equal(parsed.userIsAdministrator, false);
    assert.equal(parsed.arm64.runtime.architecture, 'arm64');
    assert.equal(parsed.x64.runtime.architecture, 'x64');
    for (const result of [parsed.arm64, parsed.x64]) {
      assert.equal(result.transcript.backendDeliveryKind, 'string');
      assert.equal(result.transcript.exactPayloadPreserved, false);
      assert.equal(result.transcript.nulDeliveredAfterUtf8Normalization, false);
    }
    return parsed;
  } finally {
    await removeRemoteFiles(sshArgs, sshTarget, [remoteArchive, remoteController]);
  }
}

const isolatedRoot = await createIsolatedRunRoot();
let success = false;
try {
  const dependency = await prepareDependencies(isolatedRoot.path);
  const result = {
    success: true,
    isolatedRootRemovedAfterRun: true,
    dependencies: dependency.packageFacts,
  };
  if (requestedPlatform === 'macos' || requestedPlatform === 'all') {
    result.macos = await runMacValidation(dependency.moduleRoot, isolatedRoot.path);
  }
  if (requestedPlatform === 'windows' || requestedPlatform === 'all') {
    result.windows = await runWindowsValidation(dependency.moduleRoot, isolatedRoot.path);
  }
  success = true;
  console.log(JSON.stringify(result));
} finally {
  await isolatedRoot.cleanup();
  if (!success) console.error('PTY dependency capability E2E failed after isolated cleanup');
}
