import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import { expectedElectronVersion } from './harness/electronRuntimeIdentity.mjs';

const fixtureDirectory = fileURLToPath(
  new URL('./fixtures/windows-nsis-current-user-lifecycle/', import.meta.url),
);
const fixtureMainPath = path.join(fixtureDirectory, 'main.mjs');
const controllerPath = fileURLToPath(
  new URL('./windows-nsis-current-user-lifecycle.e2e.ps1', import.meta.url),
);
const repositoryRoot = path.resolve(fixtureDirectory, '../../../../..');
const installerIncludePath = path.join(repositoryRoot, 'build/installer.nsh');
const sshHost = process.env.LINNYA_WINDOWS_SSH_HOST;
const sshUser = process.env.LINNYA_WINDOWS_SSH_USER;
const sshKey = process.env.LINNYA_WINDOWS_SSH_KEY;
const windowsNodeExecutable = process.env.LINNYA_WINDOWS_NODE_EXE;
const outputLimit = 256 * 1024;
const productName = 'Linnya NSIS Lifecycle Fixture';

if (process.platform !== 'darwin') {
  throw new Error('Windows NSIS lifecycle must be orchestrated from macOS');
}
if (!sshHost || !sshUser || !sshKey || !path.isAbsolute(sshKey)) {
  throw new Error('Windows NSIS lifecycle requires LINNYA_WINDOWS_SSH_HOST/USER/KEY');
}
if (!windowsNodeExecutable || !path.win32.isAbsolute(windowsNodeExecutable)) {
  throw new Error('Windows NSIS lifecycle requires absolute LINNYA_WINDOWS_NODE_EXE');
}

function appendBounded(current, chunk) {
  return `${current}${chunk.toString('utf8')}`.slice(-outputLimit);
}

function run(file, args, { cwd = repositoryRoot, timeoutMs = 180_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout = appendBounded(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = appendBounded(stderr, chunk); });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`${file} exceeded ${timeoutMs}ms`));
      else resolve({ code, signal, stdout, stderr });
    });
  });
}

async function runChecked(file, args, options) {
  const result = await run(file, args, options);
  if (result.code !== 0) {
    throw new Error(
      `${file} failed: code=${result.code} signal=${result.signal ?? 'none'} `
      + `stderr=${result.stderr} stdout=${result.stdout}`,
    );
  }
  return result;
}

async function cleanupRemote(sshArgs, target, paths) {
  const result = await runChecked('ssh', [
    ...sshArgs, target, 'powershell', '-NoLogo', '-NoProfile', '-NonInteractive',
    '-ExecutionPolicy', 'Bypass', '-File', paths.controller,
    '-FixtureMainPath', paths.fixtureMain,
    '-InstallerIncludePath', paths.installerInclude,
    '-RunRoot', paths.runRoot,
    '-ExpectedElectronVersion', expectedElectronVersion,
    '-CleanupOnly',
  ]);
  return JSON.parse(result.stdout.trim().split(/\r?\n/u).at(-1));
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function validateOnWindows() {
  const token = randomUUID().replaceAll('-', '');
  const target = `${sshUser}@${sshHost}`;
  const sshArgs = ['-i', sshKey, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8'];
  const tempRoot = `C:/Users/${sshUser}/AppData/Local/Temp`;
  const remoteRunRoot = `${tempRoot}/linnya-nsis-lifecycle-${token}`;
  const remoteController = `${tempRoot}/linnya-nsis-lifecycle-${token}.ps1`;
  const remoteFixtureMain = `${tempRoot}/linnya-nsis-lifecycle-${token}-main.mjs`;
  const remoteInstallerInclude = `${tempRoot}/linnya-nsis-lifecycle-${token}-installer.nsh`;
  let result;
  let primaryError;
  try {
    await runChecked('scp', [
      ...sshArgs,
      controllerPath,
      `${target}:/C:/Users/${sshUser}/AppData/Local/Temp/${path.basename(remoteController)}`,
    ]);
    await runChecked('scp', [
      ...sshArgs,
      fixtureMainPath,
      `${target}:/C:/Users/${sshUser}/AppData/Local/Temp/${path.basename(remoteFixtureMain)}`,
    ]);
    await runChecked('scp', [
      ...sshArgs,
      installerIncludePath,
      `${target}:/C:/Users/${sshUser}/AppData/Local/Temp/${path.basename(remoteInstallerInclude)}`,
    ]);
    const remote = await runChecked('ssh', [
      ...sshArgs, target, 'powershell', '-NoLogo', '-NoProfile', '-NonInteractive',
      '-ExecutionPolicy', 'Bypass', '-File', remoteController,
      '-NodeExecutable', windowsNodeExecutable,
      '-FixtureMainPath', remoteFixtureMain,
      '-InstallerIncludePath', remoteInstallerInclude,
      '-RunRoot', remoteRunRoot,
      '-ExpectedElectronVersion', expectedElectronVersion,
    ], { timeoutMs: 900_000 });
    result = JSON.parse(remote.stdout.trim().split(/\r?\n/u).at(-1));
  } catch (error) {
    primaryError = error;
  }

  let cleanupError;
  try {
    await cleanupRemote(sshArgs, target, {
      runRoot: remoteRunRoot,
      controller: remoteController,
      fixtureMain: remoteFixtureMain,
      installerInclude: remoteInstallerInclude,
    });
  } catch (error) {
    cleanupError = error;
  }

  if (primaryError && cleanupError) {
    throw new Error(
      `Windows NSIS lifecycle failed: ${describeError(primaryError)}\n`
      + `Remote cleanup also failed: ${describeError(cleanupError)}`,
      { cause: primaryError },
    );
  }
  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
  return result;
}

const result = await validateOnWindows();
assert.equal(result.success, true);
assert.equal(result.isAdministrator, false);
assert.equal(result.productName, productName);
assert.equal(result.versionOne, '1.0.0');
assert.equal(result.versionTwo, '1.0.1');
assert.deepEqual(result.processCounts, [0, 0, 0]);
assert.equal(result.desktopShortcutObserved, true);
assert.equal(result.startMenuShortcutObserved, true);
assert.equal(result.finalInstallRootExists, 0);
assert.equal(result.finalUninstallEntryCount, 0);
assert.match(result.quietUninstallString, /\/currentuser \/S$/u);
for (const pidName of [
  'dependencyInstallPid',
  'versionOneBuildPid',
  'versionTwoBuildPid',
  'versionOneInstallerPid',
  'versionTwoInstallerPid',
  'uninstallerPid',
]) {
  assert.equal(Number.isInteger(result[pidName]), true, `${pidName} must be an integer`);
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
