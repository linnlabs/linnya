import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import console from 'node:console';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const fixtureDirectory = fileURLToPath(new URL('./fixtures/process-trees/', import.meta.url));
const controllerPath = fileURLToPath(new URL('./windows-job-list-owner.e2e.ps1', import.meta.url));
const sshHost = process.env.LINNYA_WINDOWS_SSH_HOST;
const sshUser = process.env.LINNYA_WINDOWS_SSH_USER;
const sshKey = process.env.LINNYA_WINDOWS_SSH_KEY;
const injectLocalChannelFailure = process.env.LINNYA_E1_INJECT_LOCAL_CHANNEL_FAILURE === '1';

if (process.platform !== 'darwin') throw new Error('Windows Job List 外层 E2E 必须从 macOS 运行');
if (!sshHost || !sshUser || !sshKey || !path.isAbsolute(sshKey)) {
  throw new Error('必须设置 LINNYA_WINDOWS_SSH_HOST、LINNYA_WINDOWS_SSH_USER 和绝对路径 LINNYA_WINDOWS_SSH_KEY');
}

const sshTarget = `${sshUser}@${sshHost}`;
const sshBaseArgs = ['-i', sshKey, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8'];
const readyTimeoutMs = 90_000;
const controllerTimeoutMs = 180_000;
const runToken = randomUUID();
let remoteRunRoot;
let remoteStagingRoot;
let controller;
let controllerResultPromise;
let controllerOutput = '';
let controllerError = '';
let passed = false;
let readyEvidence;

function encodePowerShell(source) {
  return Buffer.from(source, 'utf16le').toString('base64');
}

function quotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runProcess(file, args, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${file} 超过 ${timeoutMs}ms 未结束`));
    }, timeoutMs);
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8').trim(),
        stderr: Buffer.concat(stderr).toString('utf8').trim(),
      });
    });
  });
}

async function runSshPowerShell(source, options) {
  const result = await runProcess('ssh', [
    ...sshBaseArgs,
    sshTarget,
    'powershell',
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encodePowerShell(`$ErrorActionPreference = 'Stop'\n[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)\n${source}`),
  ], options);
  if (result.code !== 0) {
    throw new Error(`远端 PowerShell 失败（exit=${result.code}）：${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

async function waitFor(description, check, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const finalValue = await check();
  if (finalValue) return finalValue;
  throw new Error(`等待${description}超过 ${timeoutMs}ms`);
}

async function readReadyEvidence(readyPath) {
  const output = await runSshPowerShell(`
$path = ${quotePowerShell(readyPath)}
if (-not (Test-Path -LiteralPath $path)) { return }
Get-Content -LiteralPath $path
`);
  if (!output) return undefined;
  const values = Object.fromEntries(output.split(/\r?\n/u).map(line => line.split('=', 2)));
  if (!values.ownerPid || !values.rootPid || !values.runToken) return undefined;
  return {
    version: Number(values.version),
    runToken: values.runToken,
    ownerPid: Number(values.ownerPid),
    ownerStartTimeUtcTicks: values.ownerStartTimeUtcTicks,
    rootPid: Number(values.rootPid),
    rootStartTimeUtcTicks: values.rootStartTimeUtcTicks,
    inJob: values.inJob === 'true',
  };
}

async function observeCrash(ready, markerPath) {
  const output = await runSshPowerShell(`
function Test-SameProcess([int]$ProcessId, [Int64]$StartTimeUtcTicks) {
  try {
    $process = [Diagnostics.Process]::GetProcessById($ProcessId)
    try { return -not $process.HasExited -and $process.StartTime.ToUniversalTime().Ticks -eq $StartTimeUtcTicks }
    finally { $process.Dispose() }
  } catch [ArgumentException] {
    return $false
  } catch [InvalidOperationException] {
    return $false
  }
}
[pscustomobject]@{
  ownerAlive = Test-SameProcess ${ready.ownerPid} ([Int64]${ready.ownerStartTimeUtcTicks})
  rootAlive = Test-SameProcess ${ready.rootPid} ([Int64]${ready.rootStartTimeUtcTicks})
  markerExists = Test-Path -LiteralPath ${quotePowerShell(markerPath)}
} | ConvertTo-Json -Compress
`);
  return JSON.parse(output);
}

async function stopExactProcess(processId, startTimeUtcTicks, role) {
  await runSshPowerShell(`
$process = [Diagnostics.Process]::GetProcessById(${processId})
try {
  if ($process.StartTime.ToUniversalTime().Ticks -ne [Int64]${startTimeUtcTicks}) {
    throw '${role} identity changed before termination'
  }
} finally {
  $process.Dispose()
}
Stop-Process -Id ${processId} -Force
`);
}

function waitForController() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      controller.kill('SIGKILL');
      reject(new Error('Windows controller 超过 ' + controllerTimeoutMs + 'ms 未结束'));
    }, controllerTimeoutMs);
    controller.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    controller.once('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stdout: controllerOutput.trim(), stderr: controllerError.trim() });
    });
  });
}

async function stopRemoteKnownProcesses(ready) {
  const controllerIdentityPath = remoteRunRoot + '\\controller-identity.json';
  const activeProbeIdentityPath = remoteRunRoot + '\\active-probe-identity.json';
  const readyIdentities = ready
    ? '@('
      + "[pscustomobject]@{ role = 'ready-owner'; processId = " + ready.ownerPid
      + '; startTimeUtcTicks = [Int64]' + ready.ownerStartTimeUtcTicks + ' },'
      + "[pscustomobject]@{ role = 'ready-root'; processId = " + ready.rootPid
      + '; startTimeUtcTicks = [Int64]' + ready.rootStartTimeUtcTicks + ' })'
    : '@()';
  const source = [
    'function Read-Identity([string]$Path) {',
    '  if (-not (Test-Path -LiteralPath $Path)) { return $null }',
    '  $identity = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json',
    "  if ($identity.version -ne 1 -or $identity.runToken -ne '" + runToken + "') { throw \"Invalid teardown identity: $Path\" }",
    '  return $identity',
    '}',
    'function Test-SameProcess($Identity) {',
    '  if ($null -eq $Identity) { return $false }',
    '  try {',
    '    $process = [Diagnostics.Process]::GetProcessById([int]$Identity.processId)',
    '    try { return $process.StartTime.ToUniversalTime().Ticks -eq [Int64]$Identity.startTimeUtcTicks }',
    '    finally { $process.Dispose() }',
    '  } catch [ArgumentException] { return $false }',
    '}',
    'function Stop-SameProcess($Identity) {',
    '  if (Test-SameProcess $Identity) { Stop-Process -Id ([int]$Identity.processId) -Force -ErrorAction SilentlyContinue }',
    '}',
    '$controller = Read-Identity ' + quotePowerShell(controllerIdentityPath),
    '$activeBefore = Read-Identity ' + quotePowerShell(activeProbeIdentityPath),
    '$readyIdentities = ' + readyIdentities,
    'Stop-SameProcess $controller',
    'Start-Sleep -Milliseconds 100',
    '$activeAfter = Read-Identity ' + quotePowerShell(activeProbeIdentityPath),
    '$identities = @($activeBefore, $activeAfter) + $readyIdentities',
    'foreach ($identity in $identities) { Stop-SameProcess $identity }',
    '$deadline = [DateTime]::UtcNow.AddSeconds(10)',
    'do {',
    '  $remaining = (@($controller, $activeBefore, $activeAfter) + $readyIdentities) | Where-Object { Test-SameProcess $_ }',
    '  if ($remaining.Count -eq 0) { break }',
    '  Start-Sleep -Milliseconds 50',
    '} while ([DateTime]::UtcNow -lt $deadline)',
    "if ($remaining.Count -gt 0) { throw 'Remote E1 teardown did not reach process zero' }",
  ].join('\n');
  await runSshPowerShell(source);
}

async function removeRemoteRunDirectories() {
  await runSshPowerShell(`
Remove-Item -LiteralPath ${quotePowerShell(remoteRunRoot)} -Recurse -Force
Remove-Item -LiteralPath ${quotePowerShell(remoteStagingRoot)} -Recurse -Force
if ((Test-Path -LiteralPath ${quotePowerShell(remoteRunRoot)}) -or (Test-Path -LiteralPath ${quotePowerShell(remoteStagingRoot)})) {
  throw 'E1 成功后的远端目录没有归零'
}
`);
}

try {
  const remoteTemp = await runSshPowerShell('[IO.Path]::GetTempPath().TrimEnd("\\")');
  remoteStagingRoot = `${remoteTemp}\\linnya-job-list-e1-${runToken}`;
  remoteRunRoot = `${remoteTemp}\\Linnya Job List E1 中文 ${runToken}`;
  const remoteSourceDirectory = `${remoteStagingRoot}\\source`;
  await runSshPowerShell(`New-Item -ItemType Directory -Path ${quotePowerShell(remoteSourceDirectory)} | Out-Null`);

  const sourceFiles = [
    path.join(fixtureDirectory, 'WindowsJobListProbe.cs'),
    path.join(fixtureDirectory, 'WindowsJobListProbe.Native.cs'),
    path.join(fixtureDirectory, 'WindowsJobListProbe.Results.cs'),
    path.join(fixtureDirectory, 'WindowsJobListProbe.Validation.cs'),
    controllerPath,
  ];
  const scp = await runProcess('scp', [
    ...sshBaseArgs,
    ...sourceFiles,
    `${sshTarget}:${remoteSourceDirectory.replaceAll('\\', '/')}/`,
  ]);
  assert.equal(scp.code, 0, scp.stderr || scp.stdout);

  const remoteControllerPath = `${remoteSourceDirectory}\\windows-job-list-owner.e2e.ps1`;
  const controllerCommand = `& ${quotePowerShell(remoteControllerPath)} -SourceDirectory ${quotePowerShell(remoteSourceDirectory)} -RunRoot ${quotePowerShell(remoteRunRoot)} -RunToken ${quotePowerShell(runToken)}`;
  controller = spawn('ssh', [
    ...sshBaseArgs,
    sshTarget,
    'powershell',
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encodePowerShell(`$ErrorActionPreference = 'Stop'\n[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)\n${controllerCommand}`),
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  controller.stdout.on('data', chunk => { controllerOutput += chunk; });
  controller.stderr.on('data', chunk => { controllerError += chunk; });
  controllerResultPromise = waitForController();

  const readyPath = `${remoteRunRoot}\\owner crash\\atomic-created.txt`;
  const markerPath = `${remoteRunRoot}\\owner crash\\user-code.marker`;
  const ackPath = `${remoteRunRoot}\\owner crash\\external-observer.ack`;
  const readyPhase = await Promise.race([
    waitFor('Windows owner 的原子 ready 证据', () => readReadyEvidence(readyPath), readyTimeoutMs)
      .then(value => ({ kind: 'ready', value })),
    controllerResultPromise.then(value => ({ kind: 'controller-ended', value })),
  ]);
  if (readyPhase.kind === 'controller-ended') {
    throw new Error(`Windows controller 在 ready 前退出（exit=${readyPhase.value.code}）：${readyPhase.value.stderr || readyPhase.value.stdout}`);
  }
  const ready = readyPhase.value;
  readyEvidence = ready;
  assert.deepEqual(
    { version: ready.version, runToken: ready.runToken, inJob: ready.inJob },
    { version: 1, runToken, inJob: true },
  );
  assert(Number.isSafeInteger(ready.ownerPid) && ready.ownerPid > 0);
  assert(Number.isSafeInteger(ready.rootPid) && ready.rootPid > 0);
  assert(/^\d+$/u.test(ready.ownerStartTimeUtcTicks));
  assert(/^\d+$/u.test(ready.rootStartTimeUtcTicks));
  execution: {
  if (injectLocalChannelFailure) {
    controller.kill('SIGKILL');
    await controllerResultPromise;
    await stopRemoteKnownProcesses(ready);
    const observation = await observeCrash(ready, markerPath);
    assert.deepEqual(observation, { ownerAlive: false, rootAlive: false, markerExists: false });
    await removeRemoteRunDirectories();
    passed = true;
    console.log(JSON.stringify({
      success: true,
      mode: 'injected-local-channel-failure',
      runToken,
      remoteProcessesGone: true,
      markerAbsent: true,
    }));
    break execution;
  }

  const beforeKill = await observeCrash(ready, markerPath);
  assert.deepEqual(beforeKill, { ownerAlive: true, rootAlive: true, markerExists: false });
  await stopExactProcess(ready.ownerPid, ready.ownerStartTimeUtcTicks, 'owner');
  const afterKill = await waitFor('owner 强杀后的 Job 自动收口', async () => {
    const observation = await observeCrash(ready, markerPath);
    return !observation.ownerAlive && !observation.rootAlive ? observation : undefined;
  });
  assert.deepEqual(afterKill, { ownerAlive: false, rootAlive: false, markerExists: false });

  const ack = {
    version: 1,
    runToken,
    success: true,
    ownerPid: ready.ownerPid,
    rootPid: ready.rootPid,
    inJobBeforeOwnerKill: true,
    markerBeforeOwnerKill: false,
    markerAfterOwnerKill: false,
    ownerGoneAfterOwnerKill: true,
    rootGoneAfterOwnerKill: true,
  };
  const ackJson = JSON.stringify(ack).replaceAll("'", "''");
  await runSshPowerShell(`
$path = ${quotePowerShell(ackPath)}
$pending = $path + '.pending'
[IO.File]::WriteAllText($pending, '${ackJson}')
[IO.File]::Move($pending, $path)
`);

  const remoteController = await controllerResultPromise;
  assert.equal(remoteController.code, 0, remoteController.stderr || remoteController.stdout);
  const resultLine = remoteController.stdout.split(/\r?\n/u).filter(Boolean).at(-1);
  const result = JSON.parse(resultLine);
  assert.equal(result.success, true);
  assert.equal(result.standardUser, true);
  assert.equal(result.argumentRoundTrip, true);
  assert.equal(result.runToken, runToken);
  assert.equal(result.recoveryAfterOwnerCrash.success, true);
  assert.deepEqual(result.externalOwnerCrash, ack);

  await removeRemoteRunDirectories();
  passed = true;
  console.log(JSON.stringify(result));
  }
} finally {
  if (!passed) {
    if (remoteRunRoot && !injectLocalChannelFailure) {
      try {
        const crashRoot = `${remoteRunRoot}\\owner crash`;
        await runSshPowerShell(`
if (Test-Path -LiteralPath ${quotePowerShell(crashRoot)}) {
  $path = Join-Path ${quotePowerShell(crashRoot)} 'external-observer.ack'
  $pending = $path + '.pending'
  [IO.File]::WriteAllText($pending, '{"version":1,"runToken":"${runToken}","success":false}')
  if (-not (Test-Path -LiteralPath $path)) { [IO.File]::Move($pending, $path) }
}
`);
      } catch {
        // 失败现场可能连 SSH 都不可达；保留原始主错误，不能用收尾错误覆盖它。
      }
    }
    if (controllerResultPromise) {
      await Promise.race([
        controllerResultPromise.then(() => undefined, () => undefined),
        new Promise(resolve => setTimeout(() => resolve(false), 5_000)),
      ]);
    }
    if (remoteRunRoot) {
      try {
        await stopRemoteKnownProcesses(readyEvidence);
      } catch (cleanupError) {
        // 失败收尾不能覆盖首个断言错误；现场与精确 identity 文件会保留供复查。
        console.error('Windows E1 远端精准收尾失败：', cleanupError);
      }
    }
    if (controller && controller.exitCode === null) controller.kill('SIGKILL');
    console.error(`Windows E1 失败现场已保留：run=${remoteRunRoot ?? '未创建'} staging=${remoteStagingRoot ?? '未创建'}`);
  }
}
