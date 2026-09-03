import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const currentFile = fileURLToPath(import.meta.url);
const timeoutMs = 30_000;

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function withTimeout(promise, description, milliseconds = timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`等待${description}超过 ${milliseconds}ms`)),
        milliseconds,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

function deferred() {
  let resolve;
  let reject;
  let settled = false;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = value => {
      settled = true;
      resolvePromise(value);
    };
    reject = error => {
      settled = true;
      rejectPromise(error);
    };
  });
  // 部分故障场景只等待统一 observerError；预先登记 rejection observer，避免其他
  // 控制 Promise 在同一错误广播时被 Node 当成未处理拒绝，同时保留 await 时的失败。
  void promise.catch(() => undefined);
  return { promise, resolve, reject, isSettled: () => settled };
}

async function settleWithin(promise, milliseconds) {
  const outcome = Promise.resolve(promise).then(
    value => ({ settled: true, value }),
    error => ({ settled: true, error }),
  );
  return Promise.race([
    outcome,
    delay(milliseconds).then(() => ({ settled: false })),
  ]);
}

function countByte(buffer, expected) {
  let count = 0;
  for (const byte of buffer) {
    if (byte === expected) count += 1;
  }
  return count;
}

function createEnvironment(overrides = {}) {
  const merged = new Map();
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !name.startsWith('=')) {
      merged.set(name.toLocaleUpperCase('en-US'), { name, value });
    }
  }
  for (const [name, value] of Object.entries(overrides)) {
    merged.set(name.toLocaleUpperCase('en-US'), { name, value });
  }
  return [...merged.values()];
}

function encodePowerShell(source) {
  return Buffer.from(source, 'utf16le').toString('base64');
}

function powerShellPath() {
  return path.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
}

function runPowerShell(source) {
  return execFileSync(
    powerShellPath(),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(source)],
    { encoding: 'utf8', windowsHide: true },
  ).trim();
}

function currentResourceCounts() {
  const output = runPowerShell([
    `$process = Get-Process -Id ${process.pid} -ErrorAction Stop`,
    '[Console]::Write((@{ handles = $process.HandleCount; threads = $process.Threads.Count } | ConvertTo-Json -Compress))',
  ].join('\n'));
  return JSON.parse(output);
}

function processIdentityAlive(identity) {
  const output = runPowerShell([
    `$process = Get-Process -Id ${identity.processId} -ErrorAction SilentlyContinue`,
    'if ($null -eq $process) { [Console]::Write("false"); exit 0 }',
    'try {',
    `  $matches = $process.StartTime.ToUniversalTime().ToFileTimeUtc().ToString() -eq '${identity.creationFileTime}'`,
    '  [Console]::Write($matches.ToString().ToLowerInvariant())',
    '} catch [System.InvalidOperationException] { [Console]::Write("false") }',
    'finally { $process.Dispose() }',
  ].join('\n'));
  return output === 'true';
}

async function waitFor(predicate, description, milliseconds = timeoutMs) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(20);
  }
  throw new Error(`等待${description}超过 ${milliseconds}ms`);
}

async function assertFileStopsChanging(pathname, description) {
  await waitFor(() => existsSync(pathname) && statSync(pathname).size > 0, description);
  await delay(120);
  const before = statSync(pathname).size;
  await delay(500);
  assert.equal(statSync(pathname).size, before, `${description}在 owner 结束后仍变化`);
}

function createObservation({ pauseFirstData = false, throwOnData = false } = {}) {
  const chunks = [];
  const rootExit = deferred();
  const terminalEof = deferred();
  const firstData = deferred();
  const observerError = deferred();
  const counts = new Map();
  let shouldPause = pauseFirstData;

  const callback = payload => {
    const [event, data, exitCode, error] = payload;
    counts.set(event, (counts.get(event) ?? 0) + 1);
    if (event === 'terminal_data') {
      if (throwOnData) throw new Error('injected terminal callback failure');
      const chunk = Buffer.from(data);
      chunks.push(chunk);
      firstData.resolve(chunk);
      if (shouldPause) {
        shouldPause = false;
        return false;
      }
      return true;
    }
    if (event === 'root_exit') rootExit.resolve(exitCode);
    else if (event === 'terminal_eof') terminalEof.resolve();
    else if (event === 'observer_error') {
      const failure = new Error(error ?? 'native PTY observer failed without detail');
      observerError.resolve(failure);
      rootExit.reject(failure);
      terminalEof.reject(failure);
      firstData.reject(failure);
    } else {
      const failure = new Error(`未知 PTY observer 事件：${String(event)}`);
      observerError.resolve(failure);
      rootExit.reject(failure);
      terminalEof.reject(failure);
      firstData.reject(failure);
    }
    return true;
  };

  return {
    callback,
    rootExit,
    terminalEof,
    firstData,
    observerError,
    output: () => Buffer.concat(chunks),
    assertTerminalCounts() {
      assert.equal(counts.get('root_exit'), 1, 'root_exit 必须只发布一次');
      assert.equal(counts.get('terminal_eof'), 1, 'terminal_eof 必须只发布一次');
    },
  };
}

function launchInput(fixturePath, mode, suiteRoot, extraArguments = []) {
  return {
    executablePath: process.execPath,
    argv: [fixturePath, mode, ...extraArguments],
    cwd: suiteRoot,
    environment: createEnvironment(),
  };
}

function launchPowerShellResizeProbe(suiteRoot) {
  const source = [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)',
    '[Console]::WriteLine(("SIZE_BEFORE:{0}x{1}" -f [Console]::WindowWidth, [Console]::WindowHeight))',
    '[void][Console]::ReadLine()',
    'Start-Sleep -Milliseconds 100',
    '[Console]::WriteLine(("SIZE_AFTER:{0}x{1}" -f [Console]::WindowWidth, [Console]::WindowHeight))',
    'exit 21',
  ].join('\n');
  return {
    executablePath: powerShellPath(),
    argv: ['-NoLogo', '-NoProfile', '-EncodedCommand', encodePowerShell(source)],
    cwd: suiteRoot,
    environment: createEnvironment(),
  };
}

function startPty(binding, input, options) {
  const nativeProcess = binding.createWindowsOwnedPtyProcessForTest(
    input,
    options?.columns ?? 80,
    options?.rows ?? 24,
  );
  const observation = createObservation(options);
  nativeProcess.startObservers(observation.callback);
  nativeProcess.resumeAfterObserversReady();
  return { nativeProcess, observation };
}

async function verifyProductionPtyExport(binding, fixturePath, suiteRoot) {
  assert.equal(typeof binding.createWindowsOwnedPtyProcess, 'function');
  const nativeProcess = binding.createWindowsOwnedPtyProcess(
    launchInput(fixturePath, '--quiet-input', suiteRoot),
    80,
    24,
  );
  const observation = createObservation();
  nativeProcess.startObservers(observation.callback);
  nativeProcess.resumeAfterObserversReady();
  const bytes = Buffer.from('production中文\r', 'utf8');
  assert.equal(
    await withTimeout(nativeProcess.writeInput(bytes), '生产 PTY input 接纳'),
    bytes.length,
  );
  assert.equal(await withTimeout(observation.rootExit.promise, '生产 PTY root exit'), 17);
  await withTimeout(nativeProcess.terminateAndWaitTreeEmpty(), '生产 PTY Job tree empty');
  await withTimeout(
    Promise.all([nativeProcess.release(), observation.terminalEof.promise]),
    '生产 PTY transcript EOF 与资源释放',
  );
  observation.assertTerminalCounts();
  assert(observation.output().includes(Buffer.from('production中文', 'utf8')));
}

async function settlePty(nativeProcess, observation, expectedExitCode) {
  let exitCode;
  try {
    exitCode = await withTimeout(observation.rootExit.promise, 'PTY root exit');
  } catch (error) {
    const transcript = observation.output().toString('utf8');
    throw new Error(
      `PTY root exit 失败；已观察终端输出=${JSON.stringify(transcript.slice(-4_096))}`,
      { cause: error },
    );
  }
  assert.equal(exitCode, expectedExitCode);
  await withTimeout(nativeProcess.terminateAndWaitTreeEmpty(), 'PTY Job tree empty');
  assert.equal(nativeProcess.activeProcessCountForTest(), 0);
  await withTimeout(
    Promise.all([nativeProcess.release(), observation.terminalEof.promise]),
    'PTY transcript EOF 与资源释放',
  );
  observation.assertTerminalCounts();
  return observation.output();
}

async function verifyQuietInput(binding, fixturePath, suiteRoot) {
  const { nativeProcess, observation } = startPty(
    binding,
    launchInput(fixturePath, '--quiet-input', suiteRoot),
  );
  const bytes = Buffer.from('hello中文\r', 'utf8');
  assert.equal(await withTimeout(nativeProcess.writeInput(bytes), '首条输出前 input'), bytes.length);
  const output = await settlePty(nativeProcess, observation, 17);
  assert.match(output.toString('utf8'), /INPUT_HEX:/u);
  assert(output.includes(Buffer.from('hello中文', 'utf8')));
}

async function verifyEof(binding, fixturePath, suiteRoot) {
  const { nativeProcess, observation } = startPty(
    binding,
    launchInput(fixturePath, '--wait-eof', suiteRoot),
  );
  assert.equal(await withTimeout(nativeProcess.writeInput(Buffer.from([0x1a, 0x0d])), 'Ctrl+Z + CR'), 2);
  await waitFor(
    () => observation.output().includes(Buffer.from('^Z')),
    'Ctrl+Z 的终端回显',
  );
  assert.equal(
    observation.rootExit.isSettled(),
    false,
    'Windows EOF action 只发送平台约定按键，不承诺任意 CLI 立即退出',
  );
  await withTimeout(nativeProcess.terminateAndWaitTreeEmpty(), 'EOF action 后独立 cancel');
  assert.equal(await withTimeout(observation.rootExit.promise, 'EOF action 后 root exit'), 1);
  await withTimeout(
    Promise.all([nativeProcess.release(), observation.terminalEof.promise]),
    'EOF action 后 transcript EOF 与资源释放',
  );
  const output = observation.output();
  assert(output.includes(Buffer.from('^Z')), 'transcript 应诚实保留 Ctrl+Z 的终端回显');
}

async function verifyResize(binding, suiteRoot) {
  const { nativeProcess, observation } = startPty(
    binding,
    launchPowerShellResizeProbe(suiteRoot),
  );
  await waitFor(
    () => observation.output().includes(Buffer.from('SIZE_BEFORE:')),
    'child 报告初始 PTY 尺寸',
  );
  nativeProcess.resize(123, 45);
  await nativeProcess.writeInput(Buffer.from('\r'));
  const output = await settlePty(nativeProcess, observation, 21);
  const text = output.toString('utf8');
  assert.match(text, /SIZE_BEFORE:80x24/u);
  assert.match(text, /SIZE_AFTER:123x45/u);
  assert.throws(() => nativeProcess.resize(0, 24), /pseudoconsole_(size|resize)/u);
}

async function verifyTranscriptBytes(binding, fixturePath, suiteRoot) {
  const { nativeProcess, observation } = startPty(
    binding,
    launchInput(fixturePath, '--byte-output', suiteRoot),
  );
  const output = await settlePty(nativeProcess, observation, 23);
  const begin = output.indexOf(Buffer.from('BYTE_BEGIN'));
  const end = output.indexOf(Buffer.from('BYTE_END'));
  assert(begin >= 0 && end > begin, '缺少 byte transcript 边界 marker');
  return {
    length: output.length,
    sha256: createHash('sha256').update(output).digest('hex'),
    hex: output.subarray(begin, end + Buffer.byteLength('BYTE_END')).toString('hex'),
    nulCount: countByte(output, 0),
    replacementCount: output.toString('utf8').split('\ufffd').length - 1,
  };
}

async function verifyOutputBackpressure(binding, fixturePath, suiteRoot) {
  const { nativeProcess, observation } = startPty(
    binding,
    launchInput(fixturePath, '--large-output', suiteRoot),
    { pauseFirstData: true },
  );
  await withTimeout(observation.firstData.promise, '第一块 PTY 输出');
  await delay(200);
  assert.equal(observation.rootExit.isSettled(), false, '输出暂停时 producer 不应完成 16 MiB');
  nativeProcess.resumeOutput();
  const output = await settlePty(nativeProcess, observation, 29);
  const begin = output.indexOf(Buffer.from('BEGIN_16M\r\n'));
  const end = output.indexOf(Buffer.from('\r\nEND_16M'), begin + 1);
  assert(begin >= 0 && end > begin, '缺少 16 MiB payload 边界 marker');
  const payload = output.subarray(begin + Buffer.byteLength('BEGIN_16M\r\n'), end);
  const payloadBytes = countByte(payload, 0x4f);
  assert(
    payloadBytes >= 16 * 1024 * 1024,
    'ConPTY terminal transcript 不得在完整结束 marker 前少于 child 已写入的 payload',
  );
  return {
    transcriptBytes: output.length,
    observedPayloadBytes: payloadBytes,
    childPayloadBytes: 16 * 1024 * 1024,
  };
}

async function verifyDetachedDescendant(binding, fixturePath, suiteRoot) {
  const heartbeat = path.join(suiteRoot, 'detached-heartbeat.log');
  const { nativeProcess, observation } = startPty(
    binding,
    launchInput(fixturePath, '--detached-descendant', suiteRoot, [heartbeat]),
  );
  assert.equal(await withTimeout(observation.rootExit.promise, 'detached root exit'), 31);
  assert(nativeProcess.activeProcessCountForTest() >= 1, 'root exit 后 detached 后代必须仍属于 Job');
  await nativeProcess.terminateAndWaitTreeEmpty();
  assert.equal(nativeProcess.activeProcessCountForTest(), 0);
  await Promise.all([nativeProcess.release(), observation.terminalEof.promise]);
  observation.assertTerminalCounts();
  await assertFileStopsChanging(heartbeat, 'detached heartbeat');
}

async function fillUntilInputBlocks(nativeProcess) {
  const action = Buffer.alloc(64 * 1024, 0x49);
  let acceptedBytes = 0;
  for (let actionIndex = 0; actionIndex < 128; actionIndex += 1) {
    const write = nativeProcess.writeInput(action);
    const outcome = await settleWithin(write, 80);
    if (!outcome.settled) {
      assert.equal(
        nativeProcess.inputWriteInProgressForTest(),
        true,
        'pending Promise 必须对应 native writer 正在 WriteFile，不能把调度延迟冒充背压',
      );
      return { write, acceptedBytes };
    }
    if (outcome.error) throw outcome.error;
    assert.equal(outcome.value, action.length);
    acceptedBytes += outcome.value;
  }
  throw new Error('8 MiB 的 64 KiB action 均未让不读 stdin 的 PTY input 阻塞');
}

async function verifyWorkerPoolCancellation(binding, fixturePath, suiteRoot) {
  const sessions = [];
  for (let index = 0; index < 4; index += 1) {
    const session = startPty(
      binding,
      launchInput(fixturePath, '--never-read', suiteRoot),
    );
    sessions.push({ ...session, ...(await fillUntilInputBlocks(session.nativeProcess)) });
  }

  const terminations = sessions.map(({ nativeProcess }) => {
    const promise = nativeProcess.terminateAndWaitTreeEmpty();
    return { promise, outcome: settleWithin(promise, 250) };
  });
  const queuedOutcomes = await Promise.all(terminations.map(({ outcome }) => outcome));
  const pendingTerminationCount = queuedOutcomes.filter(outcome => !outcome.settled).length;
  assert.equal(
    pendingTerminationCount,
    0,
    '四个 native WriteFile 同时阻塞时，异步整树 cancel 仍必须在 250ms 内获得调度',
  );
  const writeOutcomes = await Promise.all(sessions.map(({ write }) => withTimeout(
    write.then(
      bytes => ({ status: 'resolved', bytes }),
      error => ({ status: 'rejected', error: String(error) }),
    ),
    'worker pool 压力下 input write 结算',
  )));
  await Promise.all(terminations.map(({ promise }) => withTimeout(promise, 'worker pool cancel')));
  await Promise.all(sessions.map(({ nativeProcess, observation }) => withTimeout(
    Promise.all([nativeProcess.release(), observation.terminalEof.promise]),
    'worker pool 压力会话释放',
  )));
  return {
    poolSize: 4,
    asyncTerminationsPendingAfter250Ms: pendingTerminationCount,
    acceptedBytesBeforeBlock: sessions.map(session => session.acceptedBytes),
    writeStatuses: writeOutcomes.map(outcome => outcome.status),
  };
}

async function verifyReleaseUnblocksWithResume(binding, fixturePath, suiteRoot) {
  const { nativeProcess, observation } = startPty(
    binding,
    launchInput(fixturePath, '--large-output', suiteRoot),
    { pauseFirstData: true },
  );
  await withTimeout(observation.firstData.promise, 'release 竞态前第一块输出');
  await nativeProcess.terminateAndWaitTreeEmpty();
  const release = nativeProcess.release();
  const beforeResume = await settleWithin(release, 150);
  assert.equal(beforeResume.settled, false, '暂停的 terminal delivery 必须阻止 observer 提前释放');
  nativeProcess.resumeOutput();
  await withTimeout(
    Promise.all([release, observation.terminalEof.promise]),
    'resume 后 PTY release 与 terminal EOF',
  );
}

async function verifyReleaseWithoutObservers(binding, fixturePath, suiteRoot) {
  const marker = path.join(suiteRoot, 'never-started.marker');
  const nativeProcess = binding.createWindowsOwnedPtyProcessForTest(
    launchInput(fixturePath, '--write-marker', suiteRoot, [marker]),
    80,
    24,
  );
  await nativeProcess.terminateAndWaitTreeEmpty();
  await withTimeout(nativeProcess.release(), '未启动 observers 的 PTY release');
  assert.equal(existsSync(marker), false, '未 resume 的 suspended root 不得运行用户代码');
}

async function verifyCallbackFailure(binding, fixturePath, suiteRoot) {
  const { nativeProcess, observation } = startPty(
    binding,
    launchInput(fixturePath, '--large-output', suiteRoot),
    { throwOnData: true },
  );
  const error = await withTimeout(observation.observerError.promise, 'callback failure');
  assert.match(error.message, /callback/u);
  await nativeProcess.terminateAndWaitTreeEmpty();
  nativeProcess.cancelOutput();
  await nativeProcess.release();
}

async function verifyFaultInjection(binding, fixturePath, suiteRoot) {
  const stages = [
    'job_after_create',
    'pipe_after_create',
    'pseudoconsole_after_create',
    'attribute_after_initialize',
    'process_after_create',
    'input_writer_ready',
    'observer_callback_build',
    'output_observer_spawn',
    'root_observer_spawn',
    'observer_ready',
    'resume',
  ];
  for (const stage of stages) {
    const marker = path.join(suiteRoot, `fault-${stage}.marker`);
    let nativeProcess;
    assert.throws(() => {
      nativeProcess = binding.createWindowsOwnedPtyProcessWithFaultForTest(
        launchInput(fixturePath, '--write-marker', suiteRoot, [marker]),
        80,
        24,
        stage,
      );
      const observation = createObservation();
      nativeProcess.startObservers(observation.callback);
      nativeProcess.resumeAfterObserversReady();
    }, /injected stage/u, `fault stage ${stage} 必须准确失败`);
    if (nativeProcess) {
      await nativeProcess.terminateAndWaitTreeEmpty().catch(() => undefined);
      await withTimeout(nativeProcess.release(), `${stage} 失败后的 PTY release`);
    }
    assert.equal(existsSync(marker), false, `${stage} 不得运行用户代码`);
  }
}

async function verifyResourceCycles(binding, fixturePath, suiteRoot) {
  global.gc?.();
  const before = currentResourceCounts();
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const { nativeProcess, observation } = startPty(
      binding,
      launchInput(fixturePath, '--exit-23', suiteRoot),
    );
    const output = await settlePty(nativeProcess, observation, 23);
    assert(output.includes(Buffer.from('TAIL_MARKER')));
  }
  global.gc?.();
  await delay(200);
  const after = currentResourceCounts();
  assert(after.handles <= before.handles + 4, `handle 增长：${before.handles} -> ${after.handles}`);
  assert(after.threads <= before.threads + 2, `thread 增长：${before.threads} -> ${after.threads}`);
  return { before, after };
}

async function verifyOwnerDeath(bindingPath, fixturePath, suiteRoot) {
  const heartbeat = path.join(suiteRoot, 'owner-death-heartbeat.log');
  const holder = spawn(
    process.execPath,
    [currentFile, '--owner-holder', bindingPath, fixturePath, suiteRoot, heartbeat],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  let stdout = '';
  let stderr = '';
  holder.stdout.setEncoding('utf8');
  holder.stderr.setEncoding('utf8');
  holder.stdout.on('data', chunk => { stdout += chunk; });
  holder.stderr.on('data', chunk => { stderr += chunk; });
  const holderClosed = new Promise((resolve, reject) => {
    holder.once('error', reject);
    holder.once('close', (code, signal) => resolve({ code, signal }));
  });
  await Promise.race([
    waitFor(() => stdout.includes('OWNER_READY:'), 'owner holder ready'),
    holderClosed.then(({ code, signal }) => {
      throw new Error(
        `owner holder 在 ready 前退出：exit=${code} signal=${signal}; stderr=${stderr}`,
      );
    }),
  ]);
  const line = stdout.split(/\r?\n/u).find(value => value.startsWith('OWNER_READY:'));
  const rootIdentity = JSON.parse(line.slice('OWNER_READY:'.length));
  assert(processIdentityAlive(rootIdentity));
  holder.kill('SIGKILL');
  await withTimeout(holderClosed, 'owner holder exit');
  assert.equal(stderr, '');
  await waitFor(() => !processIdentityAlive(rootIdentity), 'owner death 后业务 root 消失');
  await assertFileStopsChanging(heartbeat, 'owner death heartbeat');
}

async function runOwnerHolder(bindingPath, fixturePath, suiteRoot, heartbeat) {
  const binding = require(bindingPath);
  const nativeProcess = binding.createWindowsOwnedPtyProcessForTest(
    launchInput(fixturePath, '--heartbeat', suiteRoot, [heartbeat]),
    80,
    24,
  );
  // root observer 会持有 process handle 直到退出；测试 identity 必须在 observer
  // 启动前读取，不能让 holder 为证明 owner death 而反过来等待业务 root 先结束。
  const identity = nativeProcess.rootProcessIdentityForTest();
  nativeProcess.startObservers(() => true);
  nativeProcess.resumeAfterObserversReady();
  process.stdout.write(`OWNER_READY:${JSON.stringify(identity)}\n`);
  setInterval(() => appendFileSync(path.join(suiteRoot, 'owner-holder-alive.log'), 'x'), 1_000);
}

async function runSuite(bindingPath, fixturePath, suiteRoot, architecture) {
  const binding = require(bindingPath);
  mkdirSync(suiteRoot, { recursive: true });
  assert.equal(process.arch, architecture);
  assert.equal(process.env.UV_THREADPOOL_SIZE, '4');
  const outerJob = binding.joinCurrentProcessToOuterJobForTest();

  assert.throws(
    () => binding.createWindowsOwnedPipeProcessForTest(
      launchInput(fixturePath, '--exit-23', suiteRoot),
      'pseudoconsole_after_create',
    ),
    /unknown test fault stage/u,
    '普通 pipe 不得接受只属于 PTY 的 fault stage',
  );

  assert.throws(
    () => binding.createWindowsOwnedPtyProcessForTest(
      launchInput(fixturePath, '--exit-23', suiteRoot),
      32_768,
      24,
    ),
    /pseudoconsole_size/u,
  );
  const breakawayCode = binding.attemptBreakawayProcessForTest(
    launchInput(fixturePath, '--write-marker', suiteRoot, [path.join(suiteRoot, 'breakaway.marker')]),
  );
  assert.equal(breakawayCode, 5);

  await verifyProductionPtyExport(binding, fixturePath, suiteRoot);
  await verifyQuietInput(binding, fixturePath, suiteRoot);
  await verifyEof(binding, fixturePath, suiteRoot);
  await verifyResize(binding, suiteRoot);
  const transcript = await verifyTranscriptBytes(binding, fixturePath, suiteRoot);
  const outputBytes = await verifyOutputBackpressure(binding, fixturePath, suiteRoot);
  await verifyReleaseUnblocksWithResume(binding, fixturePath, suiteRoot);
  await verifyReleaseWithoutObservers(binding, fixturePath, suiteRoot);
  await verifyDetachedDescendant(binding, fixturePath, suiteRoot);
  const inputCancellation = await verifyWorkerPoolCancellation(binding, fixturePath, suiteRoot);
  await verifyCallbackFailure(binding, fixturePath, suiteRoot);
  await verifyFaultInjection(binding, fixturePath, suiteRoot);
  await verifyOwnerDeath(bindingPath, fixturePath, suiteRoot);
  const resources = await verifyResourceCycles(binding, fixturePath, suiteRoot);

  outerJob.close();
  writeFileSync(path.join(suiteRoot, 'suite-finished.marker'), 'ok');
  console.log(JSON.stringify({
    success: true,
    architecture,
    transcript,
    outputBytes,
    inputCancellation,
    resources,
  }));
}

if (process.argv[2] === '--owner-holder') {
  await runOwnerHolder(...process.argv.slice(3, 7));
} else {
  await runSuite(...process.argv.slice(2, 6));
}
