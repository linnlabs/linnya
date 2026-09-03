import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const mode = process.argv[2];
const outputChunkBytes = 64 * 1024;
const observerTimeoutMs = 30_000;

function withTimeout(promise, description, timeoutMs = observerTimeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${description}超过 ${timeoutMs}ms`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function environmentSnapshot() {
  return Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined));
}

async function writeRepeated(stream, totalBytes, byte) {
  const chunk = Buffer.alloc(outputChunkBytes, byte);
  let written = 0;
  while (written < totalBytes) {
    if (!stream.write(chunk)) await once(stream, 'drain');
    written += chunk.length;
  }
}

function collectAndValidate(stream, expectedByte) {
  let totalBytes = 0;
  let invalidByte = false;
  let resolveFirstData;
  let rejectFirstData;
  const firstData = new Promise((resolve, reject) => {
    resolveFirstData = resolve;
    rejectFirstData = reject;
  });
  stream.on('data', bytes => {
    totalBytes += bytes.length;
    if (!bytes.every(byte => byte === expectedByte)) invalidByte = true;
    resolveFirstData();
  });
  const completed = new Promise((resolve, reject) => {
    stream.once('end', resolve);
    stream.once('error', error => {
      rejectFirstData(error);
      reject(error);
    });
  });
  return {
    firstData,
    completed,
    result() {
      return { totalBytes, invalidByte };
    },
  };
}

async function runLargeOutputEvidence(launch, cwd) {
  const totalBytes = 128 * 1024 * 1024;
  const childTracePath = path.join(cwd, 'large-output-child.trace');
  globalThis.gc?.();
  const baselineRss = process.memoryUsage().rss;
  const owned = await launch({
    executablePath: process.execPath,
    argv: [currentFile, '--large-output-child', String(totalBytes), childTracePath],
    cwd,
    environment: environmentSnapshot(),
  });
  const stderr = collectAndValidate(owned.stderr, 0x45);

  const pausedEvidenceDeadline = Date.now() + 10_000;
  while (
    (!existsSync(childTracePath) || owned.stdout.readableLength !== outputChunkBytes)
    && Date.now() < pausedEvidenceDeadline
  ) {
    await delay(25);
  }
  assert(existsSync(childTracePath), '10 秒内未观察到子进程 stderr 写入阶段');
  assert.equal(
    readFileSync(childTracePath, 'utf8'),
    'stderr-write-started',
    '子进程在 stdout 暂停后没有调度 stderr 写任务',
  );
  const pausedRss = process.memoryUsage().rss;
  const bufferedBytesBeforeConsumption = owned.stdout.readableLength;
  assert.equal(
    bufferedBytesBeforeConsumption,
    outputChunkBytes,
    '无人消费时 stdout 必须恰好停在首个 64 KiB chunk',
  );
  assert(
    pausedRss - baselineRss < 32 * 1024 * 1024,
    `无人消费时 owner RSS 增长过大：baseline=${baselineRss} paused=${pausedRss}`,
  );
  await withTimeout(Promise.race([
    stderr.firstData,
    owned.rootExit.then(rootExit => {
      throw new Error(`stderr 到达前 root 已退出：${JSON.stringify(rootExit)}`);
    }),
  ]), 'stdout 暂停时的 stderr 独立输出');
  assert.equal(stderr.result().invalidByte, false);

  const stdout = collectAndValidate(owned.stdout, 0x4f);
  const rootExit = await withTimeout(owned.rootExit, '128 MiB root exit', 120_000);
  await withTimeout(
    Promise.all([stdout.completed, stderr.completed, owned.rootClose]),
    '128 MiB 输出与 root close',
    120_000,
  );
  assert.deepEqual(rootExit, { exitCode: 0, signal: null });
  assert.deepEqual(stdout.result(), { totalBytes, invalidByte: false });
  assert.deepEqual(stderr.result(), { totalBytes: outputChunkBytes, invalidByte: false });
  assert.deepEqual(await owned.stopAndWaitForTreeEmpty(), { status: 'succeeded' });
  assert.deepEqual(await owned.release(), { status: 'succeeded' });
  return {
    totalBytes,
    bufferedBytesBeforeConsumption,
    rssGrowthBytes: pausedRss - baselineRss,
  };
}

async function runPausedCancellationEvidence(launch, cwd) {
  const owned = await launch({
    executablePath: process.execPath,
    argv: [currentFile, '--unbounded-output-child'],
    cwd,
    environment: environmentSnapshot(),
  });
  owned.stdout.on('error', () => {});
  owned.stderr.on('error', () => {});
  await delay(300);
  const bufferedBytesBeforeStop = owned.stdout.readableLength;
  assert(bufferedBytesBeforeStop <= outputChunkBytes,
    `取消前 stdout 缓冲越界：${bufferedBytesBeforeStop}`);

  const firstStop = owned.stopAndWaitForTreeEmpty();
  assert.equal(owned.stopAndWaitForTreeEmpty(), firstStop);
  assert.deepEqual(await withTimeout(firstStop, 'paused tree stop'), { status: 'succeeded' });
  owned.stdout.destroy();
  owned.stderr.destroy();
  await withTimeout(owned.rootExit, 'paused root exit');
  const firstRelease = owned.release();
  assert.equal(owned.release(), firstRelease);
  assert.deepEqual(await withTimeout(firstRelease, 'paused resource release'), { status: 'succeeded' });
  return { bufferedBytesBeforeStop };
}

async function runAdapterSuite(bindingPath, adapterPath, cwd, architecture) {
  const require = createRequire(import.meta.url);
  const binding = require(bindingPath);
  const { createWindowsJobOwnedPipeProcessLauncher } = require(adapterPath);
  const launch = createWindowsJobOwnedPipeProcessLauncher(binding);
  const largeOutput = await runLargeOutputEvidence(launch, cwd);
  const pausedCancellation = await runPausedCancellationEvidence(launch, cwd);
  console.log(JSON.stringify({
    success: true,
    architecture,
    nodeArchitecture: process.arch,
    largeOutput,
    pausedCancellation,
  }));
}

if (mode === '--large-output-child') {
  const totalBytes = Number(process.argv[3]);
  const tracePath = process.argv[4];
  // Windows 上进程自身的 pipe write 可能同步阻塞，所以让 Job 内后代负责 stdout 洪流，
  // root 延迟写 stderr。这样测试的是两条真实 pipe，而不是同一 JS 线程的调度能力。
  const stdoutWriter = spawn(process.execPath, [
    currentFile,
    '--stdout-writer-child',
    String(totalBytes),
  ], {
    stdio: ['ignore', 'inherit', 'ignore'],
    windowsHide: true,
  });
  const stdoutWriterExit = new Promise((resolve, reject) => {
    stdoutWriter.once('error', reject);
    stdoutWriter.once('close', (code, signal) => {
      if (code === 0 && signal === null) resolve();
      else reject(new Error(`stdout writer 异常退出：exit=${code} signal=${signal}`));
    });
  });
  await delay(100);
  writeFileSync(tracePath, 'stderr-write-started');
  await writeRepeated(process.stderr, outputChunkBytes, 0x45);
  await stdoutWriterExit;
} else if (mode === '--stdout-writer-child') {
  await writeRepeated(process.stdout, Number(process.argv[3]), 0x4f);
} else if (mode === '--unbounded-output-child') {
  const chunk = Buffer.alloc(outputChunkBytes, 0x55);
  while (true) {
    if (!process.stdout.write(chunk)) await once(process.stdout, 'drain');
  }
} else if (mode === '--adapter-suite') {
  await runAdapterSuite(process.argv[3], process.argv[4], process.argv[5], process.argv[6]);
} else {
  throw new Error(`未知 Windows adapter fixture mode：${String(mode)}`);
}
