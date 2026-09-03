import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';

import { expectedElectronVersion } from './harness/electronRuntimeIdentity.mjs';

const require = createRequire(import.meta.url);
const repositoryRoot = process.cwd();
const fixtureDirectory = fileURLToPath(new URL('./fixtures/app-single-instance/', import.meta.url));
const fixtureEntryPath = path.join(fixtureDirectory, 'main.ts');
const windowsControllerPath = fileURLToPath(
  new URL('./app-single-instance.e2e.ps1', import.meta.url),
);
const requestedPlatform = process.argv.find(argument => argument.startsWith('--platform='))
  ?.slice('--platform='.length) ?? 'macos';
const sshHost = process.env.LINNYA_WINDOWS_SSH_HOST;
const sshUser = process.env.LINNYA_WINDOWS_SSH_USER;
const sshKey = process.env.LINNYA_WINDOWS_SSH_KEY;
const runRoot = await realpath(
  await mkdtemp(path.join(os.tmpdir(), 'linnya-app-instance-')),
);

if (process.platform !== 'darwin') {
  throw new Error('app single-instance E2E must be orchestrated from macOS');
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

function runProcess(file, args, { cwd = repositoryRoot, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (error?.code !== 'ESRCH') reject(error);
      }
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout = `${stdout}${chunk.toString()}`.slice(-262_144); });
    child.stderr.on('data', chunk => { stderr = `${stderr}${chunk.toString()}`.slice(-262_144); });
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
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

async function waitFor(label, read, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`${label} timed out`);
}

async function readOptional(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return '';
    throw error;
  }
}

async function createFixtureProject() {
  const projectDirectory = path.join(runRoot, 'project');
  const distMainRoot = path.join(projectDirectory, 'dist', 'main');
  const distRendererRoot = path.join(projectDirectory, 'dist', 'renderer');
  await mkdir(distMainRoot, { recursive: true });
  await mkdir(distRendererRoot, { recursive: true });
  await writeFile(path.join(distMainRoot, 'preload.js'), '', 'utf8');
  await writeFile(
    path.join(distRendererRoot, 'index.html'),
    '<!doctype html><title>Linnya app owner validation</title>',
    'utf8',
  );
  await runChecked('pnpm', [
    'exec',
    'esbuild',
    fixtureEntryPath,
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--external:electron',
    `--outfile=${path.join(distMainRoot, 'main.cjs')}`,
  ]);
  await writeFile(path.join(projectDirectory, 'package.json'), `${JSON.stringify({
    name: 'linnya-app-single-instance-validation',
    version: '1.0.0',
    private: true,
    main: 'dist/main/main.cjs',
    build: {
      appId: 'com.linnyai.app-single-instance-validation',
      productName: 'Linnya App Instance Validation',
      asar: true,
      npmRebuild: false,
      electronVersion: expectedElectronVersion,
      electronFuses: {
        runAsNode: false,
        enableCookieEncryption: false,
      },
      files: ['dist/**/*', 'package.json'],
      win: { target: 'dir', signAndEditExecutable: false },
    },
  }, null, 2)}\n`, 'utf8');
  return projectDirectory;
}

function launchElectron(electronPath, bundlePath) {
  const child = spawn(electronPath, [bundlePath], {
    cwd: runRoot,
    env: { ...process.env, LINNYA_SINGLE_INSTANCE_RUN_ROOT: runRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  return { child, readStderr: () => stderr };
}

function waitForExit(processOwner, label, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(
      `${label} did not exit; stderr=${processOwner.readStderr()}`,
    )), timeoutMs);
    processOwner.child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    processOwner.child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function runMacValidation(projectDirectory) {
  const electronPath = require('electron');
  const bundlePath = path.join(projectDirectory, 'dist', 'main', 'main.cjs');
  let primary;
  let secondary;
  try {
    primary = launchElectron(electronPath, bundlePath);
    const eventLogPath = path.join(runRoot, 'events.log');
    await waitFor('primary owner readiness', async () => {
      const log = await readOptional(eventLogPath);
      return log.includes('primary-owner-ready') ? log : undefined;
    });

    secondary = launchElectron(electronPath, bundlePath);
    const secondaryExit = await waitForExit(secondary, 'secondary Electron');
    assert.deepEqual(secondaryExit, { code: 0, signal: null });
    await waitFor('second-instance delivery', async () => {
      const log = await readOptional(eventLogPath);
      return log.includes('second-instance-window-count=0') ? log : undefined;
    });
    await writeFile(path.join(runRoot, 'backend-ready'), '', 'utf8');
    await waitFor('primary readiness', async () => {
      const log = await readOptional(eventLogPath);
      return log.includes('primary-ready') ? log : undefined;
    });

    secondary = launchElectron(electronPath, bundlePath);
    const readySecondaryExit = await waitForExit(secondary, 'ready secondary Electron');
    assert.deepEqual(readySecondaryExit, { code: 0, signal: null });
    await waitFor('ready second-instance delivery', async () => {
      const log = await readOptional(eventLogPath);
      return log.includes('second-instance-window-count=1') ? log : undefined;
    });
    const eventLog = await readOptional(eventLogPath);
    assert(eventLog.includes('primary-window-count=1'));
    assert.equal(primary.child.exitCode, null);
    assert.equal(primary.child.signalCode, null);
    const writers = (await readOptional(path.join(runRoot, 'primary-writers.log')))
      .trim().split('\n').filter(Boolean);
    assert.deepEqual(writers, [String(primary.child.pid)]);

    await writeFile(path.join(runRoot, 'stop'), '', 'utf8');
    const primaryExit = await waitForExit(primary, 'primary Electron');
    assert.deepEqual(primaryExit, { code: 0, signal: null });
    return {
      platform: 'darwin',
      packaged: false,
      primaryWriters: writers.length,
      secondaryLaunches: 2,
      preBackendWindowCount: 0,
      readyWindowCount: 1,
    };
  } finally {
    if (secondary?.child.exitCode === null) secondary.child.kill('SIGKILL');
    if (primary?.child.exitCode === null) primary.child.kill('SIGKILL');
  }
}

async function removeRemoteFiles(sshArgs, sshTarget, remotePaths) {
  const source = remotePaths
    .map(remotePath => `Remove-Item -LiteralPath '${remotePath.replaceAll("'", "''")}' -Force -ErrorAction SilentlyContinue`)
    .join('; ');
  await runChecked('ssh', [
    ...sshArgs,
    sshTarget,
    'powershell', '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', source,
  ]);
}

async function runWindowsValidation(projectDirectory) {
  const outputDirectory = path.join(runRoot, 'windows-output');
  await runChecked('pnpm', [
    'exec', 'electron-builder',
    '--projectDir', projectDirectory,
    '--dir', '--win', '--x64',
    `--config.directories.output=${outputDirectory}`,
  ]);
  const executablePath = path.join(
    outputDirectory,
    'win-unpacked',
    'Linnya App Instance Validation.exe',
  );
  await stat(executablePath);

  const token = randomUUID().replaceAll('-', '');
  const archivePath = path.join(runRoot, `app-instance-${token}.tar.gz`);
  await runChecked('tar', ['-czf', archivePath, '-C', outputDirectory, 'win-unpacked']);
  const sshTarget = `${sshUser}@${sshHost}`;
  const sshArgs = ['-i', sshKey, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8'];
  const remoteRoot = `C:/Users/${sshUser}/AppData/Local/Temp`;
  const remoteArchive = `${remoteRoot}/linnya-app-instance-${token}.tar.gz`;
  const remoteController = `${remoteRoot}/linnya-app-instance-${token}.ps1`;
  try {
    await runChecked('scp', [
      ...sshArgs,
      archivePath,
      `${sshTarget}:/C:/Users/${sshUser}/AppData/Local/Temp/linnya-app-instance-${token}.tar.gz`,
    ]);
    await runChecked('scp', [
      ...sshArgs,
      windowsControllerPath,
      `${sshTarget}:/C:/Users/${sshUser}/AppData/Local/Temp/linnya-app-instance-${token}.ps1`,
    ]);
    const result = await runChecked('ssh', [
      ...sshArgs,
      sshTarget,
      'powershell', '-NoLogo', '-NoProfile', '-NonInteractive',
      '-ExecutionPolicy', 'Bypass', '-File', remoteController,
      '-ArchivePath', remoteArchive,
      '-ExpectedElectronVersion', expectedElectronVersion,
    ]);
    const summary = JSON.parse(result.stdout.trim().split(/\r?\n/u).at(-1));
    assert.equal(summary.success, true);
    assert.equal(summary.platform, 'win32');
    assert.equal(summary.architecture, 'x64');
    assert.equal(summary.packaged, true);
    assert.equal(summary.primaryWriters, 1);
    assert.equal(summary.secondaryLaunches, 4);
    assert.equal(summary.preBackendWindowCount, 0);
    assert.equal(summary.primaryWindowCount, 1);
    assert.equal(summary.readySecondInstanceWindowCount, 1);
    assert.equal(summary.primaryStayedAlive, true);
    assert.equal(summary.primaryCleanExit, true);
    assert.equal(summary.runRootRemoved, true);
    return summary;
  } finally {
    await removeRemoteFiles(sshArgs, sshTarget, [remoteArchive, remoteController]);
  }
}

let success = false;
try {
  const projectDirectory = await createFixtureProject();
  const result = { success: true, electron: expectedElectronVersion };
  if (requestedPlatform === 'macos' || requestedPlatform === 'all') {
    result.macos = await runMacValidation(projectDirectory);
  }
  if (requestedPlatform === 'windows' || requestedPlatform === 'all') {
    result.windows = await runWindowsValidation(projectDirectory);
  }
  success = true;
  console.log(JSON.stringify(result));
} finally {
  await rm(runRoot, { recursive: true, force: true });
  if (!success) console.error(`app single-instance artifacts cleaned: ${runRoot}`);
}
