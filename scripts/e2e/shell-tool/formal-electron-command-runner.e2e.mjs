import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import console from 'node:console';
import { randomUUID } from 'node:crypto';
import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import { createIsolatedRunRoot } from './harness/isolatedRunRoot.mjs';
import {
  bindElectronVersion,
  expectedElectronVersion,
} from './harness/electronRuntimeIdentity.mjs';
import {
  assertHeartbeatStopped,
  isProcessAlive,
  waitFor,
  waitForHeartbeatProgress,
  waitForProcessesExited,
} from './harness/processObservation.mjs';

const fixtureDirectory = fileURLToPath(
  new URL('./fixtures/formal-command-runner/', import.meta.url),
);
const windowsControllerPath = fileURLToPath(
  new URL('./formal-electron-command-runner.e2e.ps1', import.meta.url),
);
const repositoryRoot = path.resolve(fixtureDirectory, '../../../../..');
const utilityRunnerPath = path.join(
  repositoryRoot,
  'dist/main/commands/commandRunnerUtilityProcess.cjs',
);
const sourceWindowsRuntimeDirectory = path.join(
  repositoryRoot,
  'dist/main/commands/runtime/windows/x64',
);
const windowsRuntimeManifestFileName = 'linnyaCommandProcessOwner.manifest.json';
const expectedNodePtyVersion = '1.2.0-beta.14';
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
  throw new Error('formal Electron command runner E2E must run from macOS');
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

async function waitForJson(filePath, child, timeoutMs = 30_000) {
  return waitFor('formal command runner result', async () => {
    try {
      return JSON.parse(await readFile(filePath, 'utf8'));
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

function throwFixtureFailure(result) {
  if (result?.success === false) {
    throw new Error(`packaged fixture failed: ${result.error ?? JSON.stringify(result)}`);
  }
}

async function readPositivePid(filePath) {
  try {
    const pid = Number((await readFile(filePath, 'utf8')).trim());
    return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
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

async function readFixtureEvidence(filePath) {
  try {
    return (await readFile(filePath, 'utf8')).slice(-OUTPUT_LIMIT);
  } catch (error) {
    if (error?.code === 'ENOENT') return '<not published>';
    return `<unavailable: ${error instanceof Error ? error.message : String(error)}>`;
  }
}

async function createMacFixtureDiagnosticError(error, resultPath, observation) {
  // isolated cleanup 会在失败后删除整个运行目录；必须先把阶段和结果抄进异常，
  // 否则 Electron 卡在哪一步、是否发布过部分结果都无法在 CI 证据里追溯。
  const [stages, result] = await Promise.all([
    readFixtureEvidence(`${resultPath}.stages.log`),
    readFixtureEvidence(resultPath),
  ]);
  const message = error instanceof Error ? error.message : String(error);
  return new Error(
    `${message}\nformal macOS fixture stderr:\n${observation.stderr() || '<empty>'}`
      + `\nformal macOS fixture stages:\n${stages}`
      + `\nformal macOS fixture result:\n${result}`,
    { cause: error },
  );
}

function assertResult(result, expectedPlatform) {
  assert.equal(result.success, true);
  assert.equal(result.version, 1);
  assert.equal(result.platform, expectedPlatform);
  assert.equal(result.electron, expectedElectronVersion);
  assert.equal(result.packaged, true);
  assert.equal(result.normal.output, 'formal-adapter-output');
  assert.equal(result.normal.terminationCause, 'natural_exit');
  assert.equal(result.ownerEnd.output, '');
  assert.equal(result.ownerEnd.terminationCause, 'owner_ended');
  assert(result.ptyInput.output.includes('pty-input:accepted-value'));
  assert.equal(result.ptyInput.terminationCause, 'natural_exit');
  assert.equal(result.ptyInput.interactionAccepted, true);
  assert.equal(result.ptyOwnerEnd.terminationCause, 'owner_ended');
  assert.deepEqual(result.normal.processExit, {
    status: 'observed',
    exit_code: 0,
    signal: null,
  });
  assert.equal(result.ownerEnd.processExit.status, 'observed');
  for (const scenario of [
    result.normal,
    result.ownerEnd,
    result.ptyInput,
    result.ptyOwnerEnd,
  ]) {
    assert.deepEqual(scenario.outputDrain, { status: 'complete' });
    assert.deepEqual(scenario.treeCleanup, { status: 'succeeded' });
    assert.deepEqual(scenario.resourceRelease, { status: 'succeeded' });
    assert.equal(scenario.disconnectCount, 1);
    assert.equal(scenario.closeCount, 1);
    assert(scenario.electronProcesses.some(entry => entry.type === 'Utility'));
  }
}

async function createBuildProject(isolatedRoot) {
  const projectDirectory = path.join(isolatedRoot, 'project');
  await mkdir(path.join(projectDirectory, 'commands'), { recursive: true });
  await runChecked('pnpm', ['run', 'build:command-runner']);
  let expectedRuntimeVersion = 'unused-on-macos';
  let expectedApplicationVersion = '1.0.0';
  if (requestedPlatform === 'windows' || requestedPlatform === 'all') {
    // runner build 会 clean 整个 commands 目录；native runtime 必须在它之后生成。
    await runChecked('node', [
      'scripts/build/commands/build-windows-command-native-runtime.mjs',
    ], {
      env: {
        ...process.env,
        LINNYA_BUILD_TARGET_PLATFORM: 'win32',
        LINNYA_BUILD_TARGET_ARCH: 'x64',
      },
      timeoutMs: 120_000,
    });
    const runtimeManifest = JSON.parse(await readFile(
      path.join(sourceWindowsRuntimeDirectory, windowsRuntimeManifestFileName),
      'utf8',
    ));
    assert.equal(typeof runtimeManifest.runtime_version, 'string');
    assert.equal(typeof runtimeManifest.application_version, 'string');
    expectedRuntimeVersion = runtimeManifest.runtime_version;
    expectedApplicationVersion = runtimeManifest.application_version;
    await cp(
      sourceWindowsRuntimeDirectory,
      path.join(projectDirectory, 'runtime/windows/x64'),
      { recursive: true },
    );
  }
  await runChecked('pnpm', [
    'exec',
    'esbuild',
    path.join(fixtureDirectory, 'main.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=node20',
    '--external:electron',
    `--define:LINNYA_EXPECTED_WINDOWS_NATIVE_RUNTIME_VERSION=${JSON.stringify(expectedRuntimeVersion)}`,
    `--outfile=${path.join(projectDirectory, 'main.cjs')}`,
  ]);
  await copyFile(
    utilityRunnerPath,
    path.join(projectDirectory, 'commands/commandRunnerUtilityProcess.cjs'),
  );
  const fixturePackage = bindElectronVersion(JSON.parse(await readFile(
    path.join(fixtureDirectory, 'package.json'),
    'utf8',
  )));
  fixturePackage.version = expectedApplicationVersion;
  await writeFile(
    path.join(projectDirectory, 'package.json'),
    `${JSON.stringify(fixturePackage, null, 2)}\n`,
  );
  return projectDirectory;
}

async function buildPackage(projectDirectory, buildRoot, platform) {
  const packagePath = path.join(projectDirectory, 'package.json');
  const packageManifest = JSON.parse(await readFile(packagePath, 'utf8'));
  packageManifest.dependencies = { 'node-pty': expectedNodePtyVersion };
  const targetNodePtyPath = path.join(projectDirectory, 'node_modules/node-pty');
  await rm(targetNodePtyPath, { recursive: true, force: true });
  await mkdir(path.dirname(targetNodePtyPath), { recursive: true });
  await cp(path.join(repositoryRoot, 'node_modules/node-pty'), targetNodePtyPath, {
    recursive: true,
  });
  if (platform === 'windows') {
    packageManifest.build.extraResources = [{
      from: 'runtime/windows/x64',
      to: 'command-runtime/windows/x64',
    }];
  } else {
    delete packageManifest.build.extraResources;
  }
  await writeFile(packagePath, `${JSON.stringify(packageManifest, null, 2)}\n`);
  await runChecked('node', [
    'scripts/build/commands/prepare-node-pty-runtime.cjs',
    '--project-dir',
    projectDirectory,
    '--platform',
    platform === 'macos' ? 'darwin' : 'win32',
    '--arch',
    platform === 'macos' ? 'arm64' : 'x64',
  ]);
  const outputDirectory = path.join(buildRoot, `${platform}-output`);
  await runChecked('pnpm', [
    'exec',
    'electron-builder',
    '--projectDir',
    projectDirectory,
    '--dir',
    platform === 'macos' ? '--mac' : '--win',
    platform === 'macos' ? '--arm64' : '--x64',
    `--config.directories.output=${outputDirectory}`,
  ], { timeoutMs: 120_000 });
  return outputDirectory;
}

async function inspectPackage(appPath, asarPath) {
  const fuse = await runChecked(process.execPath, [fuseCliPath, 'read', '--app', appPath]);
  assert.match(fuse.stdout, /RunAsNode is Disabled/u);
  const asar = await runChecked(process.execPath, [asarCliPath, 'list', asarPath]);
  for (const entry of [
    '/main.cjs',
    '/commands/commandRunnerUtilityProcess.cjs',
    '/package.json',
  ]) {
    assert(asar.stdout.split(/\r?\n/u).includes(entry), `app.asar is missing ${entry}`);
  }
}

async function runMacValidation(projectDirectory, buildRoot, runRoot) {
  const outputDirectory = await buildPackage(projectDirectory, buildRoot, 'macos');
  const appPath = path.join(
    outputDirectory,
    'mac-arm64/Linnya Formal Command Runner Validation.app',
  );
  await inspectPackage(
    appPath,
    path.join(appPath, 'Contents/Resources/app.asar'),
  );
  await runChecked('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
  const executablePath = path.join(
    appPath,
    'Contents/MacOS/Linnya Formal Command Runner Validation',
  );
  const resultPath = path.join(runRoot, 'macos-result.json');
  const child = spawn(executablePath, [
    '--no-error-dialogs',
    '--enable-logging=stderr',
    `--user-data-dir=${path.join(runRoot, 'macos-electron-user-data')}`,
  ], {
    env: {
      ...process.env,
      LINNYA_FORMAL_RUNNER_RESULT_PATH: resultPath,
      LINNYA_FORMAL_RUNNER_CWD: runRoot,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const observation = observeChild(child);
  let completed = false;
  try {
    const result = await waitForJson(resultPath, child);
    throwFixtureFailure(result);
    const outcome = await observation.closed;
    assert.equal(outcome.code, 0, observation.stderr() || observation.stdout());
    assertResult(result, 'darwin');
    const observedPids = new Set([
      ...result.normal.electronProcesses.map(entry => entry.pid),
      ...result.ownerEnd.electronProcesses.map(entry => entry.pid),
      ...result.ptyInput.electronProcesses.map(entry => entry.pid),
      ...result.ptyOwnerEnd.electronProcesses.map(entry => entry.pid),
    ]);
    await waitFor('formal macOS Electron processes after App exit', () => (
      [...observedPids].every(pid => !isProcessAlive(pid))
    ), 10_000);
    const utilityCrash = await runMacUtilityCrashValidation(executablePath, runRoot);
    completed = true;
    return {
      platform: result.platform,
      architecture: result.architecture,
      normalOutput: result.normal.output,
      normalTerminationCause: result.normal.terminationCause,
      ownerEndTerminationCause: result.ownerEnd.terminationCause,
      ptyInputObserved: result.ptyInput.output.includes('pty-input:accepted-value'),
      ptyInputTerminationCause: result.ptyInput.terminationCause,
      ptyOwnerEndTerminationCause: result.ptyOwnerEnd.terminationCause,
      utilityCrash,
      observedProcessesAfterExit: 0,
    };
  } catch (error) {
    throw await createMacFixtureDiagnosticError(error, resultPath, observation);
  } finally {
    if (!completed && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await waitForProcessesExited([child.pid], 10_000);
    }
  }
}

async function runMacUtilityCrashValidation(executablePath, runRoot) {
  const runToken = randomUUID();
  const resultPath = path.join(runRoot, 'macos-utility-crash-result.json');
  const child = spawn(executablePath, [
    '--no-error-dialogs',
    '--enable-logging=stderr',
    `--user-data-dir=${path.join(runRoot, 'macos-utility-crash-user-data')}`,
  ], {
    env: {
      ...process.env,
      LINNYA_FORMAL_RUNNER_RESULT_PATH: resultPath,
      LINNYA_FORMAL_RUNNER_CWD: runRoot,
      LINNYA_FORMAL_RUNNER_MODE: 'utility-crash',
      LINNYA_FORMAL_RUNNER_CRASH_TOKEN: runToken,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const observation = observeChild(child);
  let utilityPid;
  let businessPid;
  let completed = false;
  let scenarioResult;
  let scenarioError;
  try {
    const ready = await waitForJson(resultPath, child);
    throwFixtureFailure(ready);
    assert.equal(ready.phase, 'utility_crash_ready');
    assert.equal(ready.runToken, runToken);
    assert.equal(ready.platform, 'darwin');
    utilityPid = ready.utilityPid;
    assert(Number.isSafeInteger(utilityPid) && utilityPid > 0);
    businessPid = await waitFor('utility-crash business PID', () => (
      readPositivePid(ready.businessPidPath)
    ));
    await waitForHeartbeatProgress({
      heartbeatPath: ready.heartbeatPath,
      expectedRunToken: runToken,
      expectedRole: 'root',
      expectedPid: businessPid,
    });

    process.kill(utilityPid, 'SIGKILL');
    await waitForProcessesExited([utilityPid, businessPid], 10_000);
    await assertHeartbeatStopped({
      heartbeatPath: ready.heartbeatPath,
      expectedRunToken: runToken,
      expectedRole: 'root',
      expectedPid: businessPid,
    });
    const closedResult = await waitFor('utility-crash closed result', async () => {
      const current = await waitForJson(resultPath, child, 10_000);
      throwFixtureFailure(current);
      return current.phase === 'utility_crash_closed' ? current : undefined;
    }, 10_000);
    assert.equal(closedResult.utilityPid, utilityPid);
    const outcome = await observation.closed;
    assert.equal(outcome.code, 0, observation.stderr() || observation.stdout());
    completed = true;
    scenarioResult = {
      utilityPid,
      businessPid,
      processesAfterUtilityCrash: 0,
      heartbeatStopped: true,
    };
  } catch (error) {
    scenarioError = await createMacFixtureDiagnosticError(error, resultPath, observation);
  }

  const cleanupErrors = [];
  if (!completed) {
    for (const pid of [utilityPid, businessPid, child.pid]) {
      if (!Number.isSafeInteger(pid) || pid <= 0 || !isProcessAlive(pid)) continue;
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        if (error?.code !== 'ESRCH') cleanupErrors.push(error);
      }
    }
  }
  if (scenarioError || cleanupErrors.length > 0) {
    throw new AggregateError(
      [scenarioError, ...cleanupErrors].filter(error => error !== undefined),
      'packaged macOS utility crash scenario or teardown failed',
    );
  }
  if (!scenarioResult) throw new Error('packaged macOS utility crash produced no result');
  return scenarioResult;
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

async function runWindowsValidation(projectDirectory, buildRoot) {
  const outputDirectory = await buildPackage(projectDirectory, buildRoot, 'windows');
  const executablePath = path.join(
    outputDirectory,
    'win-unpacked/Linnya Formal Command Runner Validation.exe',
  );
  await inspectPackage(
    executablePath,
    path.join(outputDirectory, 'win-unpacked/resources/app.asar'),
  );
  for (const runtimeFile of [
    'linnyaCommandProcessOwner.node',
    windowsRuntimeManifestFileName,
  ]) {
    await readFile(path.join(
      outputDirectory,
      'win-unpacked/resources/command-runtime/windows/x64',
      runtimeFile,
    ));
  }
  const token = randomUUID().replaceAll('-', '');
  const archivePath = path.join(buildRoot, `formal-runner-${token}.tar.gz`);
  await runChecked('tar', [
    '-czf',
    archivePath,
    '-C',
    outputDirectory,
    'win-unpacked',
  ], { timeoutMs: 120_000 });

  const sshTarget = `${sshUser}@${sshHost}`;
  const sshArgs = ['-i', sshKey, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8'];
  const remoteArchive = `C:/Users/${sshUser}/AppData/Local/Temp/linnya-formal-runner-${token}.tar.gz`;
  const remoteController = `C:/Users/${sshUser}/AppData/Local/Temp/linnya-formal-runner-${token}.ps1`;
  try {
    await runChecked('scp', [
      ...sshArgs,
      archivePath,
      `${sshTarget}:/C:/Users/${sshUser}/AppData/Local/Temp/linnya-formal-runner-${token}.tar.gz`,
    ], { timeoutMs: 120_000 });
    await runChecked('scp', [
      ...sshArgs,
      windowsControllerPath,
      `${sshTarget}:/C:/Users/${sshUser}/AppData/Local/Temp/linnya-formal-runner-${token}.ps1`,
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
    assert.equal(summary.normalOutput, 'formal-adapter-output');
    assert.equal(summary.normalTerminationCause, 'natural_exit');
    assert.equal(summary.ownerEndTerminationCause, 'owner_ended');
    assert.equal(summary.ptyInputObserved, true);
    assert.equal(summary.ptyInputTerminationCause, 'natural_exit');
    assert.equal(summary.ptyOwnerEndTerminationCause, 'owner_ended');
    assert.equal(summary.utilityCrashProcessesAfterExit, 0);
    assert.equal(summary.utilityCrashHeartbeatStopped, true);
    assert.equal(summary.observedProcessesAfterExit, 0);
    return summary;
  } finally {
    await removeRemoteFiles(sshArgs, sshTarget, [remoteArchive, remoteController]);
  }
}

const isolatedRoot = await createIsolatedRunRoot();
let success = false;
try {
  const buildRoot = path.join(isolatedRoot.path, 'build');
  const projectDirectory = await createBuildProject(isolatedRoot.path);
  const result = { success: true, electron: expectedElectronVersion };
  if (requestedPlatform === 'macos' || requestedPlatform === 'all') {
    result.macos = await runMacValidation(
      projectDirectory,
      buildRoot,
      isolatedRoot.path,
    );
  }
  if (requestedPlatform === 'windows' || requestedPlatform === 'all') {
    result.windows = await runWindowsValidation(projectDirectory, buildRoot);
  }
  success = true;
  console.log(JSON.stringify(result));
} finally {
  await isolatedRoot.cleanup();
  if (!success) console.error('formal Electron command runner E2E failed after isolated cleanup');
}
