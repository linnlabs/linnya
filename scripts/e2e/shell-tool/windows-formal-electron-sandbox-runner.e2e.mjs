import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import { createIsolatedRunRoot } from './harness/isolatedRunRoot.mjs';
import {
  bindElectronVersion,
  expectedElectronVersion,
} from './harness/electronRuntimeIdentity.mjs';

const fixtureDirectory = fileURLToPath(new URL(
  './fixtures/formal-sandbox-runner/',
  import.meta.url,
));
const controllerPath = fileURLToPath(new URL(
  './windows-formal-electron-sandbox-runner.e2e.ps1',
  import.meta.url,
));
const repositoryRoot = path.resolve(fixtureDirectory, '../../../../..');
const runtimeDirectory = path.join(repositoryRoot, 'dist/main/commands/runtime/windows/x64');
const runtimeManifestFileName = 'linnyaCommandProcessOwner.manifest.json';
const utilityPath = path.join(repositoryRoot, 'dist/main/sandbox/sandboxUtilityProcess.cjs');
const evaluatorPath = path.join(repositoryRoot, 'dist/main/sandbox/sandboxEvaluatorProcess.cjs');
const sandboxNodeRuntimeDirectory = path.join(
  repositoryRoot,
  'extraResources/headless-node-runtime/win32/x64',
);
const fuseCliPath = path.join(repositoryRoot, 'node_modules/@electron/fuses/dist/bin.js');
const asarCliPath = path.join(
  repositoryRoot,
  'node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar/bin/asar.js',
);
const outputLimit = 256 * 1024;
const sshHost = process.env.LINNYA_WINDOWS_SSH_HOST;
const sshUser = process.env.LINNYA_WINDOWS_SSH_USER;
const sshKey = process.env.LINNYA_WINDOWS_SSH_KEY;

if (process.platform !== 'darwin') {
  throw new Error('Windows formal Sandbox E2E must be orchestrated from macOS');
}
if (!sshHost || !sshUser || !sshKey || !path.isAbsolute(sshKey)) {
  throw new Error(
    'Windows E2E requires LINNYA_WINDOWS_SSH_HOST, LINNYA_WINDOWS_SSH_USER, '
      + 'and absolute LINNYA_WINDOWS_SSH_KEY',
  );
}

function appendBounded(current, chunk) {
  return `${current}${chunk.toString('utf8')}`.slice(-outputLimit);
}

function runProcess(file, args, {
  cwd = repositoryRoot,
  env = process.env,
  timeoutMs = 120_000,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      env,
      detached: true,
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
        reject(new Error(`${file} exceeded ${timeoutMs}ms; stderr=${stderr}; stdout=${stdout}`));
        return;
      }
      resolve({ code, signal, stdout, stderr });
    });
  });
}

async function runChecked(file, args, options) {
  const result = await runProcess(file, args, options);
  if (result.code !== 0) {
    throw new Error(
      `${file} failed: code=${result.code} signal=${result.signal ?? 'none'} `
        + `stderr=${result.stderr} stdout=${result.stdout}`,
    );
  }
  return result;
}

async function createBuildProject(rootPath) {
  const projectDirectory = path.join(rootPath, 'project');
  await Promise.all([
    mkdir(path.join(projectDirectory, 'sandbox'), { recursive: true }),
    mkdir(path.join(projectDirectory, 'headless-node-runtime/win32'), { recursive: true }),
  ]);
  await runChecked('node', [
    'scripts/build/prepare-headless-node-runtime.cjs',
    '--allow-cross-target',
  ], {
    env: {
      ...process.env,
      LINNYA_BUILD_TARGET_PLATFORM: 'win32',
      LINNYA_BUILD_TARGET_ARCH: 'x64',
    },
    timeoutMs: 120_000,
  });
  await runChecked('pnpm', ['run', 'build:sandbox-runner'], { timeoutMs: 120_000 });
  await runChecked('node', ['scripts/build/commands/build-windows-command-native-runtime.mjs'], {
    env: {
      ...process.env,
      LINNYA_BUILD_TARGET_PLATFORM: 'win32',
      LINNYA_BUILD_TARGET_ARCH: 'x64',
    },
    timeoutMs: 120_000,
  });
  const runtimeManifest = JSON.parse(await readFile(
    path.join(runtimeDirectory, runtimeManifestFileName),
    'utf8',
  ));
  await runChecked('pnpm', [
    'exec',
    'esbuild',
    path.join(fixtureDirectory, 'main.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=node20',
    '--external:electron',
    `--outfile=${path.join(projectDirectory, 'main.cjs')}`,
  ], { timeoutMs: 120_000 });
  await Promise.all([
    copyFile(utilityPath, path.join(projectDirectory, 'sandbox/sandboxUtilityProcess.cjs')),
    copyFile(evaluatorPath, path.join(projectDirectory, 'sandbox/sandboxEvaluatorProcess.cjs')),
    cp(runtimeDirectory, path.join(projectDirectory, 'runtime/windows/x64'), {
      recursive: true,
    }),
    cp(
      sandboxNodeRuntimeDirectory,
      path.join(projectDirectory, 'headless-node-runtime/win32/x64'),
      { recursive: true },
    ),
  ]);

  const packageManifest = bindElectronVersion(JSON.parse(await readFile(
    path.join(fixtureDirectory, 'package.json'),
    'utf8',
  )));
  packageManifest.version = runtimeManifest.application_version;
  packageManifest.build.productName = 'Linnya Formal Sandbox Runner Windows Validation';
  packageManifest.build.extraResources = [
    {
      from: 'runtime/windows/x64',
      to: 'command-runtime/windows/x64',
    },
    {
      from: 'headless-node-runtime/win32/x64',
      to: 'headless-node-runtime/win32/x64',
    },
    {
      from: 'sandbox/sandboxEvaluatorProcess.cjs',
      to: 'sandbox-runtime/evaluator/sandboxEvaluatorProcess.cjs',
    },
  ];
  packageManifest.build.win = {
    target: 'dir',
    signAndEditExecutable: false,
  };
  await writeFile(
    path.join(projectDirectory, 'package.json'),
    `${JSON.stringify(packageManifest, null, 2)}\n`,
  );
  return { projectDirectory, runtimeManifest };
}

async function buildPackage(projectDirectory, buildRoot) {
  const outputDirectory = path.join(buildRoot, 'windows-output');
  await runChecked('pnpm', [
    'exec',
    'electron-builder',
    '--projectDir',
    projectDirectory,
    '--dir',
    '--win',
    '--x64',
    `--config.directories.output=${outputDirectory}`,
  ], { timeoutMs: 180_000 });
  return outputDirectory;
}

async function inspectPackage(outputDirectory, runtimeManifest) {
  const executablePath = path.join(
    outputDirectory,
    'win-unpacked/Linnya Formal Sandbox Runner Windows Validation.exe',
  );
  const resourcesPath = path.join(outputDirectory, 'win-unpacked/resources');
  const asarPath = path.join(resourcesPath, 'app.asar');
  const fuse = await runChecked(process.execPath, [fuseCliPath, 'read', '--app', executablePath]);
  assert.match(fuse.stdout, /RunAsNode is Disabled/u);
  const asar = await runChecked(process.execPath, [asarCliPath, 'list', asarPath]);
  const entries = new Set(asar.stdout.split(/\r?\n/u));
  for (const entry of ['/main.cjs', '/sandbox/sandboxUtilityProcess.cjs', '/package.json']) {
    assert(entries.has(entry), `app.asar is missing ${entry}`);
  }
  for (const filePath of [
    path.join(resourcesPath, 'command-runtime/windows/x64/linnyaCommandProcessOwner.node'),
    path.join(resourcesPath, `command-runtime/windows/x64/${runtimeManifestFileName}`),
    path.join(resourcesPath, 'headless-node-runtime/win32/x64/node.exe'),
    path.join(resourcesPath, 'headless-node-runtime/win32/x64/runtime-manifest.json'),
    path.join(resourcesPath, 'headless-node-runtime/win32/x64/LICENSE'),
    path.join(resourcesPath, 'sandbox-runtime/evaluator/sandboxEvaluatorProcess.cjs'),
  ]) {
    await stat(filePath);
  }
  assert.equal(runtimeManifest.application_version.length > 0, true);
  assert.equal(runtimeManifest.runtime_version.length > 0, true);
}

async function removeRemoteFiles(sshArgs, sshTarget, remotePaths) {
  const source = remotePaths
    .map(remotePath => (
      `Remove-Item -LiteralPath '${remotePath.replaceAll("'", "''")}' -Force -ErrorAction SilentlyContinue`
    ))
    .join('; ');
  await runChecked('ssh', [
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

function assertSummary(summary) {
  assert.equal(summary.success, true);
  assert.equal(summary.version, 1);
  assert.equal(summary.platform, 'win32');
  assert.equal(summary.architecture, 'x64');
  assert.equal(summary.electron, expectedElectronVersion);
  assert.equal(summary.standardUser, true);
  assert.equal(summary.packaged, true);
  assert.equal(summary.runAsNodeDisabled, true);
  assert.equal(summary.sandboxNodeVersion, 'v24.18.1');
  assert.equal(summary.sandboxNodeAuthenticodeVerified, true);
  assert.equal(summary.scenarioCount >= 7, true);
  assert.equal(summary.utilityParentChainVerified, true);
  assert.equal(summary.evaluatorParentVerified, true);
  assert.equal(summary.evaluatorWindowHidden, true);
  assert.equal(summary.allEvaluatorTreeProcessesInJob, true);
  assert.equal(summary.allFrozenProcessesExited, true);
  assert.equal(summary.mailboxAclVerified, true);
  assert.equal(summary.everyoneWrite, false);
  assert.equal(summary.sourceInMailbox, true);
  assert.equal(summary.sourceInArgv, false);
  assert.equal(summary.nextGenerationRecovered, true);
  assert.equal(summary.storageUnlockedAndDeleted, true);
}

async function runWindowsValidation(outputDirectory, buildRoot) {
  const token = randomUUID().replaceAll('-', '');
  const archivePath = path.join(buildRoot, `windows-formal-sandbox-${token}.tar.gz`);
  await runChecked('tar', ['-czf', archivePath, '-C', outputDirectory, 'win-unpacked']);

  const sshTarget = `${sshUser}@${sshHost}`;
  const sshArgs = [
    '-i', sshKey,
    '-o', 'BatchMode=yes',
    '-o', 'IdentitiesOnly=yes',
    '-o', 'ConnectTimeout=8',
  ];
  const remoteBase = `C:/Users/${sshUser}/AppData/Local/Temp/linnya-formal-sandbox-${token}`;
  const remoteArchive = `${remoteBase}.tar.gz`;
  const remoteController = `${remoteBase}.ps1`;
  try {
    await runChecked('scp', [
      ...sshArgs,
      archivePath,
      `${sshTarget}:/C:/Users/${sshUser}/AppData/Local/Temp/linnya-formal-sandbox-${token}.tar.gz`,
    ], { timeoutMs: 120_000 });
    await runChecked('scp', [
      ...sshArgs,
      controllerPath,
      `${sshTarget}:/C:/Users/${sshUser}/AppData/Local/Temp/linnya-formal-sandbox-${token}.ps1`,
    ]);
    const result = await runChecked('ssh', [
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
      '-ExpectedElectronVersion',
      expectedElectronVersion,
    ], { timeoutMs: 240_000 });
    const summary = JSON.parse(result.stdout.trim().split(/\r?\n/u).at(-1));
    assertSummary(summary);
    return summary;
  } finally {
    await removeRemoteFiles(sshArgs, sshTarget, [remoteArchive, remoteController]);
  }
}

const isolated = await createIsolatedRunRoot('windows-formal-electron-sandbox');
let success = false;
try {
  const { projectDirectory, runtimeManifest } = await createBuildProject(isolated.path);
  const outputDirectory = await buildPackage(projectDirectory, path.join(isolated.path, 'build'));
  await inspectPackage(outputDirectory, runtimeManifest);
  const summary = await runWindowsValidation(
    outputDirectory,
    path.join(isolated.path, 'build'),
  );
  success = true;
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} finally {
  await isolated.cleanup();
  if (!success) process.stderr.write('Windows formal Sandbox E2E failed after cleanup\n');
}
