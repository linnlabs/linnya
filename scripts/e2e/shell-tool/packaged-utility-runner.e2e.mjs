import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import console from 'node:console';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import { createIsolatedRunRoot } from './harness/isolatedRunRoot.mjs';
import { expectedElectronVersion } from './harness/electronRuntimeIdentity.mjs';
import { isProcessAlive, waitFor } from './harness/processObservation.mjs';

const fixtureDirectory = fileURLToPath(
  new URL('./fixtures/packaged-utility-runner/', import.meta.url),
);
const windowsControllerPath = fileURLToPath(
  new URL('./packaged-utility-runner.e2e.ps1', import.meta.url),
);
const repositoryRoot = path.resolve(fixtureDirectory, '../../../../..');
const fuseCliPath = path.join(repositoryRoot, 'node_modules/@electron/fuses/dist/bin.js');
const asarCliPath = path.join(
  repositoryRoot,
  'node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar/bin/asar.js',
);
const requestedPlatform = process.argv.find(argument => argument.startsWith('--platform='))
  ?.slice('--platform='.length) ?? 'macos';
const sshHost = process.env.LINNYA_WINDOWS_SSH_HOST;
const sshUser = process.env.LINNYA_WINDOWS_SSH_USER;
const sshKey = process.env.LINNYA_WINDOWS_SSH_KEY;
const OUTPUT_LIMIT = 256 * 1024;

if (process.platform !== 'darwin') {
  throw new Error('packaged utility runner E2E must run from macOS');
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

function runProcess(file, args, { cwd = repositoryRoot, env = process.env, timeoutMs = 60_000 } = {}) {
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
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`${file} exceeded ${timeoutMs}ms; stderr=${stderr}`));
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

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function waitForJson(filePath, child, timeoutMs = 30_000) {
  return waitFor('packaged utility result', async () => {
    try {
      return await readJson(filePath);
    } catch (error) {
      if (error?.code === 'ENOENT' || error instanceof SyntaxError) {
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error('packaged app exited before publishing an atomic result');
        }
        return undefined;
      }
      throw error;
    }
  }, timeoutMs);
}

function observeChild(child) {
  let stdout = '';
  let stderr = '';
  const closed = new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => { stdout = appendBounded(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = appendBounded(stderr, chunk); });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  return { closed, stdout: () => stdout, stderr: () => stderr };
}

function assertSuiteResult(result, expectedPlatform) {
  assert.equal(result.success, true);
  assert.equal(result.status, 'completed');
  assert.equal(result.packaged, true);
  assert.equal(result.platform, expectedPlatform);
  assert.equal(result.electron, expectedElectronVersion);
  assert.equal(result.transport.outputBytes, 8 * 1024 * 1024);
  assert.equal(result.transport.outputEvents, 128);
  assert.equal(result.transport.maxInFlightEvents, 1);
  assert.deepEqual(result.exitBeforeReady, { exitCode: 42, messageCount: 0 });
  assert.equal(result.acknowledgementTimeout.exitCode, 1);
  assert.equal(result.acknowledgementTimeout.outputEvents, 1);
  assert.equal(result.killDuringOutput.killAccepted, true);
  assert.equal(result.killDuringOutput.outputEvents, 1);
  assert.equal(result.killDuringOutput.terminalSeen, false);
}

async function buildPackage(buildRoot, platform) {
  const outputDirectory = path.join(buildRoot, `${platform}-output`);
  const args = [
    'exec',
    'electron-builder',
    '--projectDir',
    fixtureDirectory,
    '--dir',
    platform === 'macos' ? '--mac' : '--win',
    platform === 'macos' ? '--arm64' : '--x64',
    `--config.directories.output=${outputDirectory}`,
    `--config.electronVersion=${expectedElectronVersion}`,
  ];
  await runChecked('pnpm', args, { timeoutMs: 120_000 });
  return outputDirectory;
}

async function inspectMacPackage(appPath) {
  const fuse = await runChecked(process.execPath, [fuseCliPath, 'read', '--app', appPath]);
  assert.match(fuse.stdout, /RunAsNode is Disabled/u);
  assert.match(fuse.stdout, /EnableCookieEncryption is Disabled/u);
  const asarPath = path.join(appPath, 'Contents/Resources/app.asar');
  const asar = await runChecked(process.execPath, [asarCliPath, 'list', asarPath]);
  for (const entry of ['/main.cjs', '/validation-suite.cjs', '/utility-child.cjs', '/package.json']) {
    assert(asar.stdout.split(/\r?\n/u).includes(entry), `app.asar is missing ${entry}`);
  }
  await runChecked('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
}

async function runMacSuite(appPath, runRoot) {
  const resultPath = path.join(runRoot, 'macos-suite-result.json');
  const executablePath = path.join(
    appPath,
    'Contents/MacOS/Linnya Utility Runner Validation',
  );
  const child = spawn(executablePath, [], {
    env: { ...process.env, LINNYA_UTILITY_RUNNER_RESULT_PATH: resultPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const observation = observeChild(child);
  const result = await waitForJson(resultPath, child);
  const outcome = await observation.closed;
  assert.equal(outcome.code, 0, observation.stderr() || observation.stdout());
  assertSuiteResult(result, 'darwin');
  for (const pid of [
    result.transport.utilityPid,
    result.acknowledgementTimeout.utilityPid,
    result.killDuringOutput.utilityPid,
  ]) {
    assert.equal(isProcessAlive(pid), false, `macOS utility PID remains: ${pid}`);
  }
  return result;
}

async function runMacOwnerCrash(appPath, runRoot) {
  const resultPath = path.join(runRoot, 'macos-owner-result.json');
  const executablePath = path.join(
    appPath,
    'Contents/MacOS/Linnya Utility Runner Validation',
  );
  const child = spawn(executablePath, [], {
    env: {
      ...process.env,
      LINNYA_UTILITY_RUNNER_RESULT_PATH: resultPath,
      LINNYA_UTILITY_RUNNER_MODE: 'owner-crash',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const observation = observeChild(child);
  let result;
  try {
    result = await waitForJson(resultPath, child);
    assert.equal(result.status, 'ready_for_owner_crash');
    assert.equal(result.mainPid, child.pid);
    assert.equal(result.packaged, true);
    assert(result.electronProcesses.some(entry => entry.pid === result.utilityPid));
    assert.equal(isProcessAlive(result.utilityPid), true);
    child.kill('SIGKILL');
    const outcome = await observation.closed;
    assert.equal(outcome.signal, 'SIGKILL');
    await waitFor('macOS Electron descendants after owner crash', () => (
      result.electronProcesses.every(entry => !isProcessAlive(entry.pid))
      && !isProcessAlive(result.utilityPid)
    ), 10_000);
    return {
      mainPid: result.mainPid,
      utilityPid: result.utilityPid,
      descendantsBeforeKill: result.electronProcesses,
      descendantsAfterKill: 0,
    };
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await observation.closed;
    }
  }
}

async function runMacValidation(buildRoot, runRoot) {
  const outputDirectory = await buildPackage(buildRoot, 'macos');
  const appPath = path.join(
    outputDirectory,
    'mac-arm64/Linnya Utility Runner Validation.app',
  );
  await inspectMacPackage(appPath);
  const suite = await runMacSuite(appPath, runRoot);
  const ownerCrash = await runMacOwnerCrash(appPath, runRoot);
  return {
    platform: suite.platform,
    architecture: suite.architecture,
    electron: suite.electron,
    outputBytes: suite.transport.outputBytes,
    maxInFlightEvents: suite.transport.maxInFlightEvents,
    acknowledgementDiagnosticObserved: suite.acknowledgementTimeout.diagnosticObserved,
    ownerCrash,
  };
}

async function removeRemoteFiles(sshArgs, sshTarget, remotePaths) {
  const source = remotePaths
    .map(remotePath => `Remove-Item -LiteralPath '${remotePath.replaceAll("'", "''")}' -Force -ErrorAction SilentlyContinue`)
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

async function runWindowsValidation(buildRoot) {
  const outputDirectory = await buildPackage(buildRoot, 'windows');
  const executablePath = path.join(
    outputDirectory,
    'win-unpacked/Linnya Utility Runner Validation.exe',
  );
  const fuse = await runChecked(process.execPath, [fuseCliPath, 'read', '--app', executablePath]);
  assert.match(fuse.stdout, /RunAsNode is Disabled/u);
  assert.match(fuse.stdout, /EnableCookieEncryption is Disabled/u);

  const token = randomUUID().replaceAll('-', '');
  const archivePath = path.join(buildRoot, `utility-${token}.tar.gz`);
  await runChecked('tar', [
    '-czf',
    archivePath,
    '-C',
    outputDirectory,
    'win-unpacked',
  ], { timeoutMs: 120_000 });

  const sshTarget = `${sshUser}@${sshHost}`;
  const sshArgs = ['-i', sshKey, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8'];
  const remoteArchive = `C:/Users/${sshUser}/AppData/Local/Temp/linnya-utility-${token}.tar.gz`;
  const remoteController = `C:/Users/${sshUser}/AppData/Local/Temp/linnya-utility-${token}.ps1`;
  try {
    await runChecked('scp', [
      ...sshArgs,
      archivePath,
      `${sshTarget}:/C:/Users/${sshUser}/AppData/Local/Temp/linnya-utility-${token}.tar.gz`,
    ], { timeoutMs: 120_000 });
    await runChecked('scp', [
      ...sshArgs,
      windowsControllerPath,
      `${sshTarget}:/C:/Users/${sshUser}/AppData/Local/Temp/linnya-utility-${token}.ps1`,
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
    ], { timeoutMs: 120_000 });
    const summary = JSON.parse(result.stdout.trim().split(/\r?\n/u).at(-1));
    assert.equal(summary.success, true);
    assert.equal(summary.platform, 'win32');
    assert.equal(summary.architecture, 'x64');
    assert.equal(summary.electron, expectedElectronVersion);
    assert.equal(summary.outputBytes, 8 * 1024 * 1024);
    assert.equal(summary.maxInFlightEvents, 1);
    assert.equal(summary.ownerInJob, true);
    assert.equal(summary.utilityInJob, true);
    assert.equal(summary.descendantsAfterKill, 0);
    return summary;
  } finally {
    await removeRemoteFiles(sshArgs, sshTarget, [remoteArchive, remoteController]);
  }
}

const isolatedRoot = await createIsolatedRunRoot();
let success = false;
try {
  const buildRoot = path.join(isolatedRoot.path, 'build');
  const result = { success: true, electron: expectedElectronVersion };
  if (requestedPlatform === 'macos' || requestedPlatform === 'all') {
    result.macos = await runMacValidation(buildRoot, isolatedRoot.path);
  }
  if (requestedPlatform === 'windows' || requestedPlatform === 'all') {
    result.windows = await runWindowsValidation(buildRoot);
  }
  success = true;
  console.log(JSON.stringify(result));
} finally {
  await isolatedRoot.cleanup();
  if (!success) console.error('packaged utility runner E2E failed after isolated cleanup');
}
