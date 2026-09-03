import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const require = createRequire(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(currentFile), '../../..');
const remoteMode = process.argv[2];
const observerTimeoutMs = 30_000;

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function withTimeout(promise, description, timeoutMs = observerTimeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`等待${description}超过 ${timeoutMs}ms`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createEnvironment(overrides = {}) {
  const merged = new Map();
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !name.startsWith('=')) merged.set(name.toLocaleUpperCase('en-US'), { name, value });
  }
  for (const [name, value] of Object.entries(overrides)) {
    merged.set(name.toLocaleUpperCase('en-US'), { name, value });
  }
  return [...merged.values()];
}

function quotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function encodePowerShell(source) {
  return Buffer.from(source, 'utf16le').toString('base64');
}

function quoteWindowsArgument(value) {
  const text = String(value);
  if (text.length > 0 && !/[\s"]/u.test(text)) return text;
  let result = '"';
  let pendingBackslashes = 0;
  for (const character of text) {
    if (character === '\\') {
      pendingBackslashes += 1;
    } else if (character === '"') {
      result += '\\'.repeat(pendingBackslashes * 2 + 1) + '"';
      pendingBackslashes = 0;
    } else {
      result += '\\'.repeat(pendingBackslashes) + character;
      pendingBackslashes = 0;
    }
  }
  return result + '\\'.repeat(pendingBackslashes * 2) + '"';
}

function createObservation() {
  const stdout = [];
  const stderr = [];
  const rootExit = deferred();
  const stdoutEof = deferred();
  const stderrEof = deferred();
  const eventCounts = new Map();
  let observerError;

  const callback = payload => {
    const [event, data, exitCode, error] = payload;
    eventCounts.set(event, (eventCounts.get(event) ?? 0) + 1);
    if (event === 'stdout') stdout.push(Buffer.from(data));
    else if (event === 'stderr') stderr.push(Buffer.from(data));
    else if (event === 'root_exit') rootExit.resolve(exitCode);
    else if (event === 'stdout_eof') stdoutEof.resolve();
    else if (event === 'stderr_eof') stderrEof.resolve();
    else if (event === 'observer_error') {
      observerError = new Error(error ?? 'native observer failed without detail');
      rootExit.reject(observerError);
      stdoutEof.reject(observerError);
      stderrEof.reject(observerError);
    } else {
      observerError = new Error(`未知 native observer 事件：${String(event)}`);
      rootExit.reject(observerError);
      stdoutEof.reject(observerError);
      stderrEof.reject(observerError);
    }
    return true;
  };

  return {
    callback,
    rootExit: rootExit.promise,
    stdoutEof: stdoutEof.promise,
    stderrEof: stderrEof.promise,
    terminal: Promise.all([rootExit.promise, stdoutEof.promise, stderrEof.promise]),
    getResult(exitCode) {
      if (observerError) throw observerError;
      assert.equal(eventCounts.get('root_exit'), 1, 'root exit 必须只发布一次');
      assert.equal(eventCounts.get('stdout_eof'), 1, 'stdout EOF 必须只发布一次');
      assert.equal(eventCounts.get('stderr_eof'), 1, 'stderr EOF 必须只发布一次');
      return {
        exitCode,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      };
    },
  };
}

async function runOwnedProcess(binding, input, beforeResume) {
  const nativeProcess = binding.createWindowsOwnedPipeProcess(input);
  const observation = createObservation();
  await beforeResume?.('created');
  nativeProcess.startObservers(observation.callback);
  await beforeResume?.('observers-ready');
  nativeProcess.resumeAfterObserversReady();
  const [exitCode] = await withTimeout(observation.terminal, 'root exit 与双流 EOF');
  await withTimeout(nativeProcess.terminateAndWaitTreeEmpty(), 'Job 进程树归零');
  await withTimeout(nativeProcess.release(), 'native 资源异步释放');
  return observation.getResult(exitCode);
}

async function waitForFile(pathname, description, timeoutMs = observerTimeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(pathname) && statSync(pathname).size > 0) return;
    await delay(25);
  }
  throw new Error(`等待${description}超过 ${timeoutMs}ms`);
}

async function assertFileStopsChanging(pathname, description) {
  await waitForFile(pathname, description);
  await delay(150);
  const firstSize = statSync(pathname).size;
  await delay(500);
  assert.equal(statSync(pathname).size, firstSize, `${description}在 owner 结束后仍变化`);
}

function powerShellPath() {
  return path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

async function verifyArgumentRoundTrip(binding, suiteRoot) {
  const values = ['', 'space value', '中文', 'trailing\\', 'embedded"quote'];
  const result = await runOwnedProcess(binding, {
    executablePath: process.execPath,
    argv: [currentFile, '--argv-echo', ...values],
    cwd: suiteRoot,
    environment: createEnvironment(),
  });
  assert.equal(result.exitCode, 17);
  assert.deepEqual(JSON.parse(result.stdout.toString('utf8')), values);
  assert.equal(result.stderr.length, 0);
}

async function verifyPowerShellAndSuspendedGate(binding, suiteRoot) {
  const cwd = path.join(suiteRoot, 'PowerShell 中文 cwd');
  const marker = path.join(cwd, 'resume.marker');
  mkdirSync(cwd, { recursive: true });
  const script = [
    "$utf8 = New-Object Text.UTF8Encoding($false)",
    '[Console]::OutputEncoding = $utf8',
    `[IO.File]::WriteAllText(${quotePowerShell(marker)}, 'resumed', $utf8)`,
    "[Console]::Out.WriteLine(('OUT|' + $env:LINNYA_UNICODE_VALUE + '|' + [Environment]::CurrentDirectory))",
    "[Console]::Error.WriteLine('ERR|中文')",
    'exit 23',
  ].join('\n');
  const phases = [];
  const result = await runOwnedProcess(binding, {
    executablePath: powerShellPath(),
    argv: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    cwd,
    environment: createEnvironment({ LINNYA_UNICODE_VALUE: '环境值' }),
  }, phase => {
    phases.push(phase);
    assert.equal(existsSync(marker), false, `用户代码在 ${phase} 阶段提前运行`);
  });
  assert.deepEqual(phases, ['created', 'observers-ready']);
  assert.equal(readFileSync(marker, 'utf8'), 'resumed');
  assert.equal(result.exitCode, 23);
  assert.equal(result.stdout.toString('utf8').trim(), `OUT|环境值|${cwd}`);
  assert.equal(result.stderr.toString('utf8').trim(), 'ERR|中文');
}

async function verifyActiveJobRejectsRelease(binding, suiteRoot) {
  const marker = path.join(suiteRoot, 'active-job-release.marker');
  const nativeProcess = binding.createWindowsOwnedPipeProcess({
    executablePath: process.execPath,
    argv: [currentFile, '--write-marker', marker],
    cwd: suiteRoot,
    environment: createEnvironment(),
  });
  const observation = createObservation();
  nativeProcess.startObservers(observation.callback);

  await assert.rejects(
    () => withTimeout(nativeProcess.release(), '活动 Job 的 release 拒绝'),
    error => String(error).includes('Job still owns active processes'),
  );
  assert.equal(existsSync(marker), false, 'release 拒绝前不应恢复用户代码');

  await withTimeout(nativeProcess.terminateAndWaitTreeEmpty(), 'release 拒绝后的 Job 归零');
  const [exitCode] = await withTimeout(observation.terminal, 'release 拒绝后的 root 与双 EOF');
  await withTimeout(nativeProcess.release(), 'release 拒绝后的最终资源释放');
  observation.getResult(exitCode);
}

async function verifyBoundedDualStream(binding, suiteRoot) {
  const result = await runOwnedProcess(binding, {
    executablePath: process.execPath,
    argv: [currentFile, '--dual-stream'],
    cwd: suiteRoot,
    environment: createEnvironment(),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.length, 256 * 1024);
  assert.equal(result.stderr.length, 256 * 1024);
  assert(result.stdout.every(byte => byte === 0x4f));
  assert(result.stderr.every(byte => byte === 0x45));
}

async function verifyBackgroundDescendant(binding, suiteRoot) {
  const heartbeat = path.join(suiteRoot, 'background-child.heartbeat');
  const childScript = [
    `$path = ${quotePowerShell(heartbeat)}`,
    "while ($true) { [IO.File]::AppendAllText($path, 'x'); Start-Sleep -Milliseconds 50 }",
  ].join('\n');
  const rootScript = [
    `$powershell = ${quotePowerShell(powerShellPath())}`,
    `$arguments = @('-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', '${encodePowerShell(childScript)}')`,
    'Start-Process -FilePath $powershell -ArgumentList $arguments | Out-Null',
    'exit 0',
  ].join('; ');
  const nativeProcess = binding.createWindowsOwnedPipeProcess({
    executablePath: powerShellPath(),
    argv: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', rootScript],
    cwd: suiteRoot,
    environment: createEnvironment(),
  });
  const observation = createObservation();
  nativeProcess.startObservers(observation.callback);
  nativeProcess.resumeAfterObserversReady();
  const exitCode = await withTimeout(observation.rootExit, '后台后代场景的 root exit');
  assert.equal(exitCode, 0);
  await waitForFile(heartbeat, '后台后代心跳');

  await delay(300);
  const heartbeatBeforeTermination = statSync(heartbeat).size;
  await delay(150);
  assert(
    statSync(heartbeat).size > heartbeatBeforeTermination,
    'root exit 被错误当成整棵进程树归零，后台后代没有继续运行',
  );

  const terminateStartedAt = Date.now();
  await withTimeout(Promise.all([
    nativeProcess.terminateAndWaitTreeEmpty(),
    nativeProcess.terminateAndWaitTreeEmpty(),
  ]), '并发主动终止后台后代');
  assert(
    Date.now() - terminateStartedAt < 2_000,
    '主动取消被并发 tree-empty 观察阻塞；不能等待五秒观察期限后才终止',
  );
  const [, stdoutEof, stderrEof] = await withTimeout(
    Promise.all([observation.rootExit, observation.stdoutEof, observation.stderrEof]),
    '后台后代终止后的双流 EOF',
  );
  assert.equal(stdoutEof, undefined);
  assert.equal(stderrEof, undefined);
  await withTimeout(nativeProcess.release(), '后台后代 native 资源异步释放');
  await assertFileStopsChanging(heartbeat, '后台后代心跳');
}

function readCurrentHandleCount() {
  const command = `(Get-Process -Id ${process.pid}).HandleCount`;
  const result = spawnSync(powerShellPath(), [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command,
  ], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const count = Number(result.stdout.trim());
  assert(Number.isSafeInteger(count) && count > 0, `无法读取当前 Node handle 数：${result.stdout}`);
  return count;
}

function verifyStandardUser() {
  const script = [
    '$identity = [Security.Principal.WindowsIdentity]::GetCurrent()',
    '$principal = New-Object Security.Principal.WindowsPrincipal($identity)',
    '[pscustomobject]@{',
    '  isAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
    '  isUser = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::User)',
    '} | ConvertTo-Json -Compress',
  ].join('\n');
  const result = spawnSync(powerShellPath(), [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script,
  ], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const membership = JSON.parse(result.stdout.trim());
  assert.deepEqual(membership, { isAdministrator: false, isUser: true });
  return membership;
}

async function verifyHandleListExcludesSentinel(binding, bindingPath, suiteRoot) {
  const sentinel = binding.createInheritableHandleSentinelForTest();
  try {
    const result = await runOwnedProcess(binding, {
      executablePath: process.execPath,
      argv: [currentFile, '--signal-handle', bindingPath, sentinel.rawHandle()],
      cwd: suiteRoot,
      environment: createEnvironment(),
    });
    assert.equal(result.exitCode, 0);
    assert.equal(JSON.parse(result.stdout.toString('utf8')), false);
    assert.equal(sentinel.wasSignaled(), false);
  } finally {
    sentinel.close();
  }
}

async function verifyNestedJobAndBreakawayDenial(binding, suiteRoot) {
  const outerJob = binding.joinCurrentProcessToOuterJobForTest();
  try {
    const nested = await runOwnedProcess(binding, {
      executablePath: process.execPath,
      argv: [currentFile, '--empty-success'],
      cwd: suiteRoot,
      environment: createEnvironment(),
    });
    assert.equal(nested.exitCode, 0);

    const marker = path.join(suiteRoot, 'unexpected-breakaway.marker');
    const breakawayError = binding.attemptBreakawayProcessForTest({
      executablePath: process.execPath,
      argv: [currentFile, '--write-marker', marker],
      cwd: suiteRoot,
      environment: createEnvironment(),
    });
    assert.equal(breakawayError, 5, '未启用 BREAKAWAY_OK 的 outer Job 应拒绝显式逃离');
    await delay(100);
    assert.equal(existsSync(marker), false, '被拒绝的 breakaway 仍运行了用户代码');
  } finally {
    outerJob.close();
  }
}

function isExactProcessAlive(identity) {
  const script = [
    `try { $process = [Diagnostics.Process]::GetProcessById(${identity.processId})`,
    `  try { if (-not $process.HasExited -and $process.StartTime.ToUniversalTime().ToFileTimeUtc() -eq [Int64]${identity.creationFileTime}) { 'true' } else { 'false' } }`,
    "  finally { $process.Dispose() } } catch [ArgumentException] { 'false' } catch [InvalidOperationException] { 'false' }",
  ].join('\n');
  const result = spawnSync(powerShellPath(), [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script,
  ], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim() === 'true';
}

async function verifyRepeatedResourceRelease(binding, suiteRoot, iterations) {
  const execute = () => runOwnedProcess(binding, {
    executablePath: process.execPath,
    argv: [currentFile, '--empty-success'],
    cwd: suiteRoot,
    environment: createEnvironment(),
  });
  for (let index = 0; index < 5; index += 1) await execute();
  globalThis.gc?.();
  await delay(250);
  const baselineHandleCount = readCurrentHandleCount();
  for (let index = 0; index < iterations; index += 1) {
    const result = await execute();
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.length, 0);
    assert.equal(result.stderr.length, 0);
  }
  globalThis.gc?.();
  await delay(500);
  const finalHandleCount = readCurrentHandleCount();
  assert(
    finalHandleCount <= baselineHandleCount + 2,
    `重复释放后宿主 handle 累积：baseline=${baselineHandleCount} final=${finalHandleCount}`,
  );
  return { baselineHandleCount, finalHandleCount };
}

async function verifyCreationGateFailures(binding, suiteRoot) {
  assert.equal(typeof binding.createWindowsOwnedPipeProcessForTest, 'function');
  const stages = [
    'job_after_create',
    'pipe_after_create',
    'attribute_after_initialize',
    'process_after_create',
    'observer_callback_build',
    'observer_ready',
    'resume',
  ];
  for (const stage of stages) {
    const marker = path.join(suiteRoot, `fault-${stage}.marker`);
    const input = {
      executablePath: process.execPath,
      argv: [currentFile, '--write-marker', marker],
      cwd: suiteRoot,
      environment: createEnvironment(),
    };
    if (stage === 'job_after_create' || stage === 'pipe_after_create'
      || stage === 'attribute_after_initialize' || stage === 'process_after_create') {
      assert.throws(
        () => binding.createWindowsOwnedPipeProcessForTest(input, stage),
        error => String(error).includes(`injected stage=${stage}`),
      );
    } else {
      const nativeProcess = binding.createWindowsOwnedPipeProcessForTest(input, stage);
      const observation = createObservation();
      if (stage === 'observer_callback_build' || stage === 'observer_ready') {
        assert.throws(
          () => nativeProcess.startObservers(observation.callback),
          error => String(error).includes(`injected stage=${stage}`),
        );
      } else {
        nativeProcess.startObservers(observation.callback);
        assert.throws(
          () => nativeProcess.resumeAfterObserversReady(),
          error => String(error).includes(`injected stage=${stage}`),
        );
      }
      if (stage === 'observer_callback_build') {
        await withTimeout(nativeProcess.release(), `${stage} 失败后的资源释放`);
      } else {
        const [exitCode] = await withTimeout(observation.terminal, `${stage} 失败后的 root 与双 EOF`);
        await withTimeout(nativeProcess.terminateAndWaitTreeEmpty(), `${stage} 失败后的 Job 归零`);
        await withTimeout(nativeProcess.release(), `${stage} 失败后的资源释放`);
        observation.getResult(exitCode);
      }
    }
    await delay(100);
    assert.equal(existsSync(marker), false, `${stage} 失败后用户代码仍然运行`);
  }
}

async function verifyOutputCallbackFailures(binding, suiteRoot) {
  for (const failureMode of ['throw', 'invalid-return']) {
    const nativeProcess = binding.createWindowsOwnedPipeProcess({
      executablePath: process.execPath,
      argv: [currentFile, '--continuous-output'],
      cwd: suiteRoot,
      environment: createEnvironment(),
    });
    const observerError = deferred();
    const rootExit = deferred();
    let failureInjected = false;
    nativeProcess.startObservers(payload => {
      const [event, , exitCode, error] = payload;
      if (event === 'stdout' && !failureInjected) {
        failureInjected = true;
        if (failureMode === 'throw') throw new Error('injected output callback failure');
        return undefined;
      }
      if (event === 'observer_error') observerError.resolve(error);
      if (event === 'root_exit') rootExit.resolve(exitCode);
      return true;
    });
    nativeProcess.resumeAfterObserversReady();
    const message = await withTimeout(observerError.promise, `${failureMode} observer error`);
    assert.match(message, /output.callback|callback failed|boolean/iu);
    await withTimeout(rootExit.promise, `${failureMode} root exit`);
    await withTimeout(nativeProcess.terminateAndWaitTreeEmpty(), `${failureMode} Job 归零`);
    await withTimeout(nativeProcess.release(), `${failureMode} 资源释放`);
  }
}

async function verifyOwnerDeath(bindingPath, suiteRoot, iterations) {
  for (let index = 0; index < iterations; index += 1) {
    const heartbeat = path.join(suiteRoot, `owner-death-${index}.heartbeat`);
    const owner = spawn(process.execPath, [
      currentFile,
      '--owner-child',
      bindingPath,
      heartbeat,
      suiteRoot,
    ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let rootIdentity;
    const ready = deferred();
    owner.stdout.on('data', chunk => {
      stdout += chunk.toString('utf8');
      const readyLine = stdout.split(/\r?\n/u).find(line => line.startsWith('OWNER_READY:'));
      if (readyLine && !rootIdentity) {
        rootIdentity = JSON.parse(readyLine.slice('OWNER_READY:'.length));
        ready.resolve();
      }
    });
    owner.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    const ownerClosed = new Promise((resolve, reject) => {
      owner.once('error', reject);
      owner.once('close', (code, signal) => resolve({ code, signal }));
    });
    await withTimeout(Promise.race([
      ready.promise,
      ownerClosed.then(({ code, signal }) => {
        throw new Error(`owner 在 ready 前退出：exit=${code} signal=${signal} stderr=${stderr}`);
      }),
    ]), `第 ${index + 1} 轮 owner ready`);
    await waitForFile(heartbeat, `第 ${index + 1} 轮 owner child 心跳`);
    assert.equal(owner.kill('SIGKILL'), true, '无法终止本轮明确创建的 Node owner');
    await withTimeout(ownerClosed, `第 ${index + 1} 轮 Node owner 退出`);
    await assertFileStopsChanging(heartbeat, `第 ${index + 1} 轮 owner-death 心跳`);
    assert.equal(isExactProcessAlive(rootIdentity), false, 'owner 强杀后原 root 身份仍存活');
  }
}

async function runRemoteSuite(bindingPath, suiteRoot, architecture) {
  const binding = require(bindingPath);
  assert.equal(typeof binding.createWindowsOwnedPipeProcess, 'function');
  mkdirSync(suiteRoot, { recursive: true });
  const standardUser = verifyStandardUser();
  await verifyArgumentRoundTrip(binding, suiteRoot);
  await verifyPowerShellAndSuspendedGate(binding, suiteRoot);
  await verifyActiveJobRejectsRelease(binding, suiteRoot);
  await verifyBoundedDualStream(binding, suiteRoot);
  await verifyBackgroundDescendant(binding, suiteRoot);
  await verifyHandleListExcludesSentinel(binding, bindingPath, suiteRoot);
  await verifyOwnerDeath(bindingPath, suiteRoot, 10);
  await verifyCreationGateFailures(binding, suiteRoot);
  await verifyOutputCallbackFailures(binding, suiteRoot);
  await verifyNestedJobAndBreakawayDenial(binding, suiteRoot);
  const resourceStress = await verifyRepeatedResourceRelease(binding, suiteRoot, 100);
  console.log(JSON.stringify({
    success: true,
    architecture,
    nodeArchitecture: process.arch,
    nodeVersion: process.version,
    powerShell: '5.1',
    standardUser,
    activeJobReleaseRejected: true,
    handleListSentinelExcluded: true,
    nestedJob: true,
    breakawayError: 5,
    ownerDeathIterations: 10,
    resourceReleaseIterations: 100,
    creationGateFailureStages: 7,
    outputCallbackFailureModes: 2,
    resourceStress,
    dualStreamBytes: 256 * 1024,
  }));
}

function runProcess(file, args, timeoutMs = 180_000) {
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

function createRemoteControllerSource({
  nodePath,
  nodeArguments,
  runToken,
  controllerIdentityPath,
  workerIdentityPath,
}) {
  return [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)',
    'function Publish-Identity([string]$Path, [string]$Role, [Diagnostics.Process]$Process) {',
    '  $value = [pscustomobject]@{',
    '    version = 1',
    `    runToken = ${quotePowerShell(runToken)}`,
    '    role = $Role',
    '    processId = $Process.Id',
    '    creationFileTime = $Process.StartTime.ToUniversalTime().ToFileTimeUtc().ToString()',
    '  } | ConvertTo-Json -Compress',
    "  $pending = $Path + '.pending'",
    '  [IO.File]::WriteAllText($pending, $value)',
    '  if (Test-Path -LiteralPath $Path) { Remove-Item -Force -LiteralPath $Path }',
    '  [IO.File]::Move($pending, $Path)',
    '}',
    '$controller = [Diagnostics.Process]::GetCurrentProcess()',
    `Publish-Identity ${quotePowerShell(controllerIdentityPath)} 'controller' $controller`,
    '$startInfo = New-Object Diagnostics.ProcessStartInfo',
    `$startInfo.FileName = ${quotePowerShell(nodePath)}`,
    `$startInfo.Arguments = ${quotePowerShell(nodeArguments)}`,
    '$startInfo.UseShellExecute = $false',
    '$startInfo.CreateNoWindow = $true',
    '$startInfo.RedirectStandardOutput = $true',
    '$startInfo.RedirectStandardError = $true',
    '$worker = New-Object Diagnostics.Process',
    '$worker.StartInfo = $startInfo',
    "if (-not $worker.Start()) { throw 'remote Node worker did not start' }",
    `Publish-Identity ${quotePowerShell(workerIdentityPath)} 'worker' $worker`,
    '$stdout = $worker.StandardOutput.ReadToEndAsync()',
    '$stderr = $worker.StandardError.ReadToEndAsync()',
    '$worker.WaitForExit()',
    '[Console]::Out.Write($stdout.GetAwaiter().GetResult())',
    '[Console]::Error.Write($stderr.GetAwaiter().GetResult())',
    'exit $worker.ExitCode',
  ].join('\n');
}

function createExactRemoteTeardownSource({ runToken, identityPaths }) {
  const paths = identityPaths.map(quotePowerShell).join(', ');
  return [
    "$ErrorActionPreference = 'Stop'",
    'function Stop-ExactIdentity([string]$Path) {',
    '  if (-not (Test-Path -LiteralPath $Path)) { return }',
    '  $identity = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json',
    `  if ($identity.version -ne 1 -or $identity.runToken -ne ${quotePowerShell(runToken)}) { throw "invalid teardown identity: $Path" }`,
    '  try {',
    '    $process = [Diagnostics.Process]::GetProcessById([int]$identity.processId)',
    '    try {',
    '      if ($process.StartTime.ToUniversalTime().ToFileTimeUtc().ToString() -eq [string]$identity.creationFileTime) {',
    '        Stop-Process -Id $process.Id -Force',
    '        if (-not $process.WaitForExit(10000)) { throw "exact process did not exit: $Path" }',
    '      }',
    '    } finally { $process.Dispose() }',
    '  } catch [ArgumentException] { } catch [InvalidOperationException] { }',
    '}',
    `$identities = @(${paths})`,
    '# worker 先结束，让 KILL_ON_JOB_CLOSE 收掉命令树；controller 只负责传输测试结果。',
    'foreach ($path in $identities) { Stop-ExactIdentity $path }',
    'foreach ($path in $identities) { Remove-Item -Force -LiteralPath $path -ErrorAction SilentlyContinue }',
  ].join('\n');
}

async function verifyRemoteChannelFailureTeardown({
  sshArgs,
  sshTarget,
  runToken,
  remoteStaging,
  nodePath,
  remoteScript,
  remoteBinding,
}) {
  const controllerIdentityPath = `${remoteStaging}\\channel-failure-controller.json`;
  const workerIdentityPath = `${remoteStaging}\\channel-failure-worker.json`;
  const heartbeatPath = `${remoteStaging}\\channel-failure-child.heartbeat`;
  const suiteRoot = remoteStaging;
  const nodeArguments = [
    remoteScript, '--owner-child', remoteBinding, heartbeatPath, suiteRoot,
  ].map(quoteWindowsArgument).join(' ');
  const channel = spawn('ssh', [
    ...sshArgs,
    sshTarget,
    'powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', encodePowerShell(createRemoteControllerSource({
      nodePath,
      nodeArguments,
      runToken,
      controllerIdentityPath,
      workerIdentityPath,
    })),
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let channelStderr = '';
  channel.stderr.on('data', chunk => { channelStderr += chunk.toString('utf8'); });
  const channelClosed = new Promise((resolve, reject) => {
    channel.once('error', reject);
    channel.once('close', (code, signal) => resolve({ code, signal }));
  });
  const identityPaths = [workerIdentityPath, controllerIdentityPath];
  let readyEvidence;
  let primaryError;
  try {
    const readyScript = [
      "$ErrorActionPreference = 'Stop'",
      '$deadline = [DateTime]::UtcNow.AddSeconds(30)',
      `while ((-not (Test-Path -LiteralPath ${quotePowerShell(controllerIdentityPath)})) -or (-not (Test-Path -LiteralPath ${quotePowerShell(workerIdentityPath)})) -or (-not (Test-Path -LiteralPath ${quotePowerShell(heartbeatPath)}))) {`,
      "  if ([DateTime]::UtcNow -ge $deadline) { throw 'channel failure identities or heartbeat did not become ready' }",
      '  Start-Sleep -Milliseconds 25',
      '}',
      '[pscustomobject]@{',
      `  controller = Get-Content -Raw -LiteralPath ${quotePowerShell(controllerIdentityPath)} | ConvertFrom-Json`,
      `  worker = Get-Content -Raw -LiteralPath ${quotePowerShell(workerIdentityPath)} | ConvertFrom-Json`,
      '} | ConvertTo-Json -Depth 4 -Compress',
    ].join('\n');
    const ready = await runProcess('ssh', [
      ...sshArgs,
      sshTarget,
      'powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
      encodePowerShell(readyScript),
    ], 40_000);
    assert.equal(ready.code, 0, ready.stderr || ready.stdout);
    readyEvidence = JSON.parse(ready.stdout.split(/\r?\n/u).filter(Boolean).at(-1));
    assert.equal(channel.kill('SIGKILL'), true, '无法注入本地 SSH 通道中断');
    await withTimeout(channelClosed, '本地 SSH 通道中断', 10_000);
  } catch (error) {
    primaryError = error;
  }

  let teardownError;
  try {
    const teardown = await runProcess('ssh', [
      ...sshArgs,
      sshTarget,
      'powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
      encodePowerShell(createExactRemoteTeardownSource({ runToken, identityPaths })),
    ]);
    assert.equal(teardown.code, 0, teardown.stderr || teardown.stdout);
    if (readyEvidence) {
      const observeScript = [
        'function Test-ExactIdentity($Identity) {',
        '  try {',
        '    $process = [Diagnostics.Process]::GetProcessById([int]$Identity.processId)',
        '    try { return -not $process.HasExited -and $process.StartTime.ToUniversalTime().ToFileTimeUtc().ToString() -eq [string]$Identity.creationFileTime }',
        '    finally { $process.Dispose() }',
        '  } catch [ArgumentException] { return $false } catch [InvalidOperationException] { return $false }',
        '}',
        `$controller = '${JSON.stringify(readyEvidence.controller).replaceAll("'", "''")}' | ConvertFrom-Json`,
        `$worker = '${JSON.stringify(readyEvidence.worker).replaceAll("'", "''")}' | ConvertFrom-Json`,
        `$before = (Get-Item -LiteralPath ${quotePowerShell(heartbeatPath)}).Length`,
        'Start-Sleep -Milliseconds 600',
        `$after = (Get-Item -LiteralPath ${quotePowerShell(heartbeatPath)}).Length`,
        '[pscustomobject]@{',
        '  controllerAlive = Test-ExactIdentity $controller',
        '  workerAlive = Test-ExactIdentity $worker',
        '  heartbeatStopped = $before -eq $after',
        '} | ConvertTo-Json -Compress',
      ].join('\n');
      const observation = await runProcess('ssh', [
        ...sshArgs,
        sshTarget,
        'powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
        encodePowerShell(observeScript),
      ]);
      assert.equal(observation.code, 0, observation.stderr || observation.stdout);
      assert.deepEqual(
        JSON.parse(observation.stdout.split(/\r?\n/u).filter(Boolean).at(-1)),
        { controllerAlive: false, workerAlive: false, heartbeatStopped: true },
      );
    }
  } catch (error) {
    teardownError = error;
  }

  let channelCleanupError;
  if (channel.exitCode === null && channel.signalCode === null) {
    try {
      if (!channel.kill('SIGKILL')) throw new Error('无法终止故障测试的本地 SSH');
      await withTimeout(channelClosed, '故障测试本地 SSH 收尾', 10_000);
    } catch (error) {
      channelCleanupError = new Error(`故障测试本地 SSH 收尾失败：${channelStderr}`, { cause: error });
    }
  }
  const failures = [primaryError, teardownError, channelCleanupError].filter(Boolean);
  if (failures.length > 1) {
    throw new AggregateError(failures, '通道中断注入或其收尾存在多个失败');
  }
  if (failures.length === 1) throw failures[0];
}

async function runRemoteNodeWithExactTeardown({
  sshArgs,
  sshTarget,
  nodePath,
  nodeArguments,
  runToken,
  remoteStaging,
  identityPrefix,
}) {
  const controllerIdentityPath = `${remoteStaging}\\${identityPrefix}-controller-identity.json`;
  const workerIdentityPath = `${remoteStaging}\\${identityPrefix}-worker-identity.json`;
  let execution;
  let executionError;
  try {
    execution = await runProcess('ssh', [
      ...sshArgs,
      sshTarget,
      'powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', encodePowerShell(createRemoteControllerSource({
        nodePath,
        nodeArguments,
        runToken,
        controllerIdentityPath,
        workerIdentityPath,
      })),
    ], 240_000);
  } catch (error) {
    executionError = error;
  }
  let teardownError;
  try {
    const teardown = await runProcess('ssh', [
      ...sshArgs,
      sshTarget,
      'powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
      encodePowerShell(createExactRemoteTeardownSource({
        runToken,
        identityPaths: [workerIdentityPath, controllerIdentityPath],
      })),
    ]);
    assert.equal(teardown.code, 0, teardown.stderr || teardown.stdout);
  } catch (error) {
    teardownError = error;
  }
  if (executionError && teardownError) {
    throw new AggregateError(
      [executionError, teardownError],
      `${identityPrefix} 执行与远端精准收尾同时失败`,
    );
  }
  if (executionError) throw executionError;
  if (teardownError) throw teardownError;
  return execution;
}

async function runLocalCoordinator() {
  const sshHost = process.env.LINNYA_WINDOWS_SSH_HOST;
  const sshUser = process.env.LINNYA_WINDOWS_SSH_USER;
  const sshKey = process.env.LINNYA_WINDOWS_SSH_KEY;
  if (process.platform !== 'darwin') throw new Error('Windows native owner 外层 E2E 必须从 macOS 运行');
  if (!sshHost || !sshUser || !sshKey || !path.isAbsolute(sshKey)) {
    throw new Error('必须设置 LINNYA_WINDOWS_SSH_HOST、LINNYA_WINDOWS_SSH_USER 和绝对路径 LINNYA_WINDOWS_SSH_KEY');
  }

  const sshTarget = `${sshUser}@${sshHost}`;
  const sshArgs = ['-i', sshKey, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8'];
  const runToken = randomUUID();
  const localStaging = mkdtempSync(path.join(tmpdir(), 'linnya-windows-native-owner-'));
  const remoteStaging = `C:\\Users\\${sshUser}\\AppData\\Local\\Temp\\linnya-native-owner-${runToken}`;
  const localArtifacts = {
    x64: path.join(repositoryRoot, 'src/infra/adapters/command-runtime/windows/native/target/x86_64-pc-windows-msvc/release/linnya_command_process_owner.dll'),
    arm64: path.join(repositoryRoot, 'src/infra/adapters/command-runtime/windows/native/target/aarch64-pc-windows-msvc/release/linnya_command_process_owner.dll'),
  };
  try {
    const manifestPath = path.join(repositoryRoot, 'src/infra/adapters/command-runtime/windows/native/Cargo.toml');
    for (const target of ['x86_64-pc-windows-msvc', 'aarch64-pc-windows-msvc']) {
      const build = await runProcess('cargo', [
        'xwin', 'build', '--manifest-path', manifestPath, '--release', '--target', target,
        '--features', 'test-fault-injection',
      ]);
      assert.equal(build.code, 0, build.stderr || build.stdout);
    }
    for (const [architecture, artifact] of Object.entries(localArtifacts)) {
      assert(existsSync(artifact), `缺少 ${architecture} release native artifact：${artifact}`);
      copyFileSync(artifact, path.join(localStaging, `linnyaCommandProcessOwner.${architecture}.node`));
    }
    const adapterBundle = path.join(localStaging, 'windowsOwnedPipeAdapter.cjs');
    const adapterBuild = await runProcess('pnpm', [
      'exec', 'esbuild',
      path.join(repositoryRoot, 'src/infra/adapters/local-process-runtime/windows/createWindowsJobOwnedPipeProcess.ts'),
      '--bundle', '--platform=node', '--format=cjs', `--outfile=${adapterBundle}`,
    ]);
    assert.equal(adapterBuild.code, 0, adapterBuild.stderr || adapterBuild.stdout);
    const adapterFixture = path.join(
      repositoryRoot,
      'scripts/e2e/shell-tool/fixtures/process-trees/windows-owned-pipe-adapter-host.mjs',
    );
    copyFileSync(currentFile, path.join(localStaging, path.basename(currentFile)));
    copyFileSync(adapterFixture, path.join(localStaging, path.basename(adapterFixture)));
    const createRemote = await runProcess('ssh', [
      ...sshArgs,
      sshTarget,
      'powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
      encodePowerShell(`$ErrorActionPreference = 'Stop'\nNew-Item -ItemType Directory -Force -Path '${remoteStaging}' | Out-Null`),
    ]);
    assert.equal(createRemote.code, 0, createRemote.stderr || createRemote.stdout);
    const transfer = await runProcess('scp', [
      ...sshArgs,
      path.join(localStaging, path.basename(currentFile)),
      path.join(localStaging, path.basename(adapterFixture)),
      adapterBundle,
      path.join(localStaging, 'linnyaCommandProcessOwner.x64.node'),
      path.join(localStaging, 'linnyaCommandProcessOwner.arm64.node'),
      `${sshTarget}:${remoteStaging.replaceAll('\\', '/')}/`,
    ]);
    assert.equal(transfer.code, 0, transfer.stderr || transfer.stdout);

    const results = [];
    for (const architecture of ['x64', 'arm64']) {
      const nodePath = `C:\\Users\\${sshUser}\\AppData\\Local\\Temp\\linnya-napi-spike\\node-v22.23.1-win-${architecture}\\node.exe`;
      const remoteScript = `${remoteStaging}\\${path.basename(currentFile)}`;
      const remoteBinding = `${remoteStaging}\\linnyaCommandProcessOwner.${architecture}.node`;
      const remoteAdapter = `${remoteStaging}\\windowsOwnedPipeAdapter.cjs`;
      const remoteAdapterFixture = `${remoteStaging}\\${path.basename(adapterFixture)}`;
      const suiteRoot = `${remoteStaging}\\suite-${architecture}-中文`;
      const nodeArguments = [
        '--expose-gc', remoteScript, '--remote-suite', remoteBinding, suiteRoot, architecture,
      ].map(quoteWindowsArgument).join(' ');
      const execution = await runRemoteNodeWithExactTeardown({
        sshArgs,
        sshTarget,
        nodePath,
        nodeArguments,
        runToken,
        remoteStaging,
        identityPrefix: architecture,
      });
      assert.equal(execution.code, 0, execution.stderr || execution.stdout);
      const resultLine = execution.stdout.split(/\r?\n/u).filter(Boolean).at(-1);
      const result = JSON.parse(resultLine);
      assert.equal(result.success, true);
      assert.equal(result.architecture, architecture);
      assert.equal(result.nodeArchitecture, architecture);
      const adapterArguments = [
        '--expose-gc', remoteAdapterFixture, '--adapter-suite', remoteBinding,
        remoteAdapter, suiteRoot, architecture,
      ].map(quoteWindowsArgument).join(' ');
      const adapterExecution = await runRemoteNodeWithExactTeardown({
        sshArgs,
        sshTarget,
        nodePath,
        nodeArguments: adapterArguments,
        runToken,
        remoteStaging,
        identityPrefix: `${architecture}-adapter`,
      });
      assert.equal(adapterExecution.code, 0, adapterExecution.stderr || adapterExecution.stdout);
      const adapterResult = JSON.parse(
        adapterExecution.stdout.split(/\r?\n/u).filter(Boolean).at(-1),
      );
      assert.equal(adapterResult.success, true);
      assert.equal(adapterResult.architecture, architecture);
      assert.equal(adapterResult.nodeArchitecture, architecture);
      results.push({ ...result, adapter: adapterResult });
    }
    await verifyRemoteChannelFailureTeardown({
      sshArgs,
      sshTarget,
      runToken,
      remoteStaging,
      nodePath: `C:\\Users\\${sshUser}\\AppData\\Local\\Temp\\linnya-napi-spike\\node-v22.23.1-win-arm64\\node.exe`,
      remoteScript: `${remoteStaging}\\${path.basename(currentFile)}`,
      remoteBinding: `${remoteStaging}\\linnyaCommandProcessOwner.arm64.node`,
    });
    console.log(JSON.stringify({ success: true, runToken, results }));
  } finally {
    rmSync(localStaging, { recursive: true, force: true });
    await runProcess('ssh', [
      ...sshArgs,
      sshTarget,
      'powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
      encodePowerShell(`Remove-Item -Recurse -Force -LiteralPath '${remoteStaging}' -ErrorAction SilentlyContinue`),
    ]).catch(() => undefined);
  }
}

if (remoteMode === '--argv-echo') {
  process.stdout.write(JSON.stringify(process.argv.slice(3)));
  process.exitCode = 17;
} else if (remoteMode === '--dual-stream') {
  await Promise.all([
    new Promise((resolve, reject) => process.stdout.write(Buffer.alloc(256 * 1024, 0x4f), error => error ? reject(error) : resolve())),
    new Promise((resolve, reject) => process.stderr.write(Buffer.alloc(256 * 1024, 0x45), error => error ? reject(error) : resolve())),
  ]);
} else if (remoteMode === '--empty-success') {
  process.exitCode = 0;
} else if (remoteMode === '--continuous-output') {
  const chunk = Buffer.alloc(64 * 1024, 0x43);
  while (true) process.stdout.write(chunk);
} else if (remoteMode === '--write-marker') {
  writeFileSync(process.argv[3], 'user-code-ran');
} else if (remoteMode === '--signal-handle') {
  const binding = require(process.argv[3]);
  process.stdout.write(JSON.stringify(binding.signalHandleForTest(process.argv[4])));
} else if (remoteMode === '--heartbeat-root') {
  const heartbeat = process.argv[3];
  appendFileSync(heartbeat, 'ready');
  setInterval(() => appendFileSync(heartbeat, 'x'), 50);
} else if (remoteMode === '--owner-child') {
  const [bindingPath, heartbeat, cwd] = process.argv.slice(3);
  const binding = require(bindingPath);
  const nativeProcess = binding.createWindowsOwnedPipeProcess({
    executablePath: process.execPath,
    argv: [currentFile, '--heartbeat-root', heartbeat],
    cwd,
    environment: createEnvironment(),
  });
  const rootIdentity = nativeProcess.rootProcessIdentityForTest();
  nativeProcess.startObservers(() => true);
  nativeProcess.resumeAfterObserversReady();
  console.log(`OWNER_READY:${JSON.stringify(rootIdentity)}`);
  setInterval(() => undefined, 1_000);
} else if (remoteMode === '--remote-suite') {
  await runRemoteSuite(process.argv[3], process.argv[4], process.argv[5]);
} else {
  await runLocalCoordinator();
}
