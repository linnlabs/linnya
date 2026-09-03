import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { OwnedPipeProcessStartupCleanupError } from '../../../../../shared/process-runtime/index.js';
import type {
  LaunchOwnedPipeProcess,
  OwnedPipeProcess,
  OwnedProcessResourceReleaseResult,
  OwnedProcessRootExit,
  OwnedProcessTreeStopResult,
} from '../../../../../shared/process-runtime/index.js';
import type { SandboxRunnerEvaluationResult } from '../../../runner-evaluation/definitions/sandboxRunnerEvaluation.js';
import type { SandboxUtilityChildPayload } from '../definitions/sandboxUtilityTransport.js';
import { serializeSandboxControlFrame } from '../functions/createSandboxControlFrameStateMachine.js';
import { publishSandboxResultMailbox } from '../functions/sandboxMailboxFiles.js';
import { runSandboxUtilityProcess } from '../orchestration/runSandboxUtilityProcess.js';

const RUN_TOKEN = '0'.repeat(32);
const STDERR_TAIL_MAX_BYTES = 64 * 1024;

interface RecordedLaunch extends LaunchOwnedPipeProcess {
  readonly calls: Parameters<LaunchOwnedPipeProcess>[0][];
  readonly signals: (AbortSignal | undefined)[];
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function createOwnedProcess() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const rootExit = deferred<OwnedProcessRootExit>();
  const rootClose = deferred<void>();
  const treeEmpty = deferred<OwnedProcessTreeStopResult>();
  const releaseResult = deferred<OwnedProcessResourceReleaseResult>();
  let stopCount = 0;
  let releaseCount = 0;
  const process: OwnedPipeProcess = {
    stdout,
    stderr,
    rootExit: rootExit.promise,
    rootClose: rootClose.promise,
    treeEmpty: treeEmpty.promise,
    stopAndWaitForTreeEmpty() {
      stopCount += 1;
      return treeEmpty.promise;
    },
    release() {
      releaseCount += 1;
      return releaseResult.promise;
    },
  };
  return {
    process,
    stdout,
    stderr,
    rootExit,
    rootClose,
    treeEmpty,
    releaseResult,
    get stopCount() {
      return stopCount;
    },
    get releaseCount() {
      return releaseCount;
    },
  };
}

describe('Sandbox Utility 单次 run 编排', () => {
  const roots: string[] = [];

  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  });

  async function createRunDirectory(): Promise<string> {
    const root = await mkdtemp(path.join(os.tmpdir(), 'linnya-sandbox-utility-run-'));
    roots.push(root);
    return root;
  }

  it('只有 control、双流、root、tree、release 和 mailbox 全部结算后才发布自然终态', async () => {
    const runDirectory = await createRunDirectory();
    const owned = createOwnedProcess();
    const published: SandboxUtilityChildPayload[] = [];
    const launch = createLaunch(owned.process);
    const run = createRun({ runDirectory, launch, published });
    const completion = run.start();
    await waitFor(() => launch.calls.length === 1);

    await publishSandboxResultMailbox({
      runDirectory,
      runToken: RUN_TOKEN,
      result: successfulEvaluation(),
    });
    for (const kind of ['ready', 'started', 'result_committed'] as const) {
      owned.stdout.write(
        serializeSandboxControlFrame({
          protocol_version: 1,
          kind,
          run_token: RUN_TOKEN,
          pid: 2468,
        })
      );
      await waitFor(() =>
        published
          .filter(payload => payload.kind === 'sandbox_evaluator_frame')
          .some(payload => payload.frame === kind)
      );
    }
    owned.stderr.write('diagnostic 中文');
    owned.stdout.end();
    owned.stderr.end();
    owned.rootExit.resolve({ exitCode: 0, signal: null });
    owned.rootClose.resolve();
    owned.treeEmpty.resolve({ status: 'succeeded' });
    await waitFor(() => owned.releaseCount === 1);
    expect(terminalPayload(published)).toBeUndefined();
    owned.releaseResult.resolve({ status: 'succeeded' });
    await completion;

    expect(owned.stopCount).toBe(0);
    expect(launch.calls[0]?.argv).toContain('--max-old-space-size=64');
    expect(terminalPayload(published)).toMatchObject({
      cause: 'natural',
      rootExit: { exitCode: 0, signal: null },
      control: { completed: true, evaluatorPid: 2468 },
      stderrBytes: Buffer.byteLength('diagnostic 中文'),
      stderrTail: 'diagnostic 中文',
      settlementFailures: [],
    });
  });

  it('启动前取消不创建进程，并保持取消为唯一终因', async () => {
    const runDirectory = await createRunDirectory();
    const published: SandboxUtilityChildPayload[] = [];
    const launch = createLaunch(createOwnedProcess().process);
    const run = createRun({ runDirectory, launch, published });

    run.terminate('cancelled');
    await run.start();

    expect(launch.calls).toEqual([]);
    expect(terminalPayload(published)).toMatchObject({
      cause: 'cancelled',
      settlementFailures: [],
    });
  });

  it('运行中取消只停止一次，并且迟到 transport failure 不改写取消终因', async () => {
    const runDirectory = await createRunDirectory();
    const owned = createOwnedProcess();
    const published: SandboxUtilityChildPayload[] = [];
    const launch = createLaunch(owned.process);
    const run = createRun({ runDirectory, launch, published });
    const completion = run.start();
    await waitFor(() => launch.calls.length === 1);

    owned.stdout.write(
      serializeSandboxControlFrame({
        protocol_version: 1,
        kind: 'ready',
        run_token: RUN_TOKEN,
        pid: 2468,
      })
    );
    await waitFor(() => published.some(payload => payload.kind === 'sandbox_evaluator_frame'));
    run.terminate('cancelled');
    run.terminate('transport_failed');
    expect(owned.stopCount).toBe(1);

    owned.stdout.destroy();
    owned.stderr.end();
    owned.rootExit.resolve({ exitCode: null, signal: 'SIGTERM' });
    owned.rootClose.resolve();
    owned.treeEmpty.resolve({ status: 'succeeded' });
    await waitFor(() => owned.releaseCount === 1);
    owned.releaseResult.resolve({ status: 'succeeded' });
    await completion;

    expect(owned.stopCount).toBe(1);
    expect(terminalPayload(published)?.cause).toBe('cancelled');
  });

  it('launch 尚未返回时取消会中止启动，并且普通 abort 拒绝不会伪造成 launch failure', async () => {
    const runDirectory = await createRunDirectory();
    const published: SandboxUtilityChildPayload[] = [];
    const launch = createPendingLaunch();
    const run = createRun({ runDirectory, launch, published });
    const completion = run.start();

    expect(launch.calls).toHaveLength(1);
    run.terminate('cancelled');
    expect(launch.signals[0]?.aborted).toBe(true);
    launch.pending.reject(new Error('platform launch aborted'));
    await completion;

    expect(terminalPayload(published)).toMatchObject({
      cause: 'cancelled',
      settlementFailures: [],
    });
  });

  it('launch 尚未返回时不消耗 VM 执行预算，但仍由 idle timeout 有界收口', async () => {
    vi.useFakeTimers();
    const runDirectory = await createRunDirectory();
    const published: SandboxUtilityChildPayload[] = [];
    const launch = createPendingLaunch();
    const completion = createRun({
      runDirectory,
      launch,
      published,
      timeoutMs: 50,
      idleTimeoutMs: 500,
    }).start();

    await vi.advanceTimersByTimeAsync(50);
    expect(launch.signals[0]?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(450);
    expect(launch.signals[0]?.aborted).toBe(true);
    launch.pending.reject(new Error('platform launch aborted after idle timeout'));
    await completion;
    await vi.advanceTimersByTimeAsync(1_000);

    expect(terminalPayload(published)).toMatchObject({
      cause: 'idle_timed_out',
      settlementFailures: [],
    });
  });

  it('Evaluator 确认 started 后 hard timeout 才开始且只停止一次，idle timer 不能覆盖终因', async () => {
    vi.useFakeTimers();
    const runDirectory = await createRunDirectory();
    const owned = createOwnedProcess();
    const published: SandboxUtilityChildPayload[] = [];
    const run = createRun({
      runDirectory,
      launch: createLaunch(owned.process),
      published,
      timeoutMs: 50,
      idleTimeoutMs: 500,
    });
    const completion = run.start();
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(50);
    expect(owned.stopCount).toBe(0);
    for (const kind of ['ready', 'started'] as const) {
      owned.stdout.write(
        serializeSandboxControlFrame({
          protocol_version: 1,
          kind,
          run_token: RUN_TOKEN,
          pid: 2468,
        })
      );
      await flushUntil(() =>
        published.some(
          payload => payload.kind === 'sandbox_evaluator_frame' && payload.frame === kind
        )
      );
    }

    await vi.advanceTimersByTimeAsync(50);
    expect(owned.stopCount).toBe(1);
    settleOwnedProcess(owned, { exitCode: null, signal: 'SIGTERM' });
    await flushUntil(() => owned.releaseCount === 1);
    owned.releaseResult.resolve({ status: 'succeeded' });
    await completion;
    await vi.advanceTimersByTimeAsync(1_000);

    expect(owned.stopCount).toBe(1);
    expect(terminalPayload(published)?.cause).toBe('timed_out');
  });

  it('result_committed 后退出与资源释放变慢时不再由业务 hard timeout 改写结果', async () => {
    vi.useFakeTimers();
    const runDirectory = await createRunDirectory();
    const owned = createOwnedProcess();
    const published: SandboxUtilityChildPayload[] = [];
    const completion = createRun({
      runDirectory,
      launch: createLaunch(owned.process),
      published,
      timeoutMs: 50,
      idleTimeoutMs: 500,
    }).start();
    await flushMicrotasks();

    await publishSandboxResultMailbox({
      runDirectory,
      runToken: RUN_TOKEN,
      result: successfulEvaluation(),
    });
    for (const kind of ['ready', 'started', 'result_committed'] as const) {
      owned.stdout.write(
        serializeSandboxControlFrame({
          protocol_version: 1,
          kind,
          run_token: RUN_TOKEN,
          pid: 2468,
        })
      );
      await flushUntil(() =>
        published.some(
          payload => payload.kind === 'sandbox_evaluator_frame' && payload.frame === kind
        )
      );
    }

    await vi.advanceTimersByTimeAsync(100);
    expect(owned.stopCount).toBe(0);
    settleOwnedProcess(owned, { exitCode: 0, signal: null });
    await flushUntil(() => owned.releaseCount === 1);
    owned.releaseResult.resolve({ status: 'succeeded' });
    await completion;

    expect(terminalPayload(published)?.cause).toBe('natural');
  });

  it('idle-only timeout 独立归因，后续 hard timeout 不能覆盖终因', async () => {
    vi.useFakeTimers();
    const runDirectory = await createRunDirectory();
    const owned = createOwnedProcess();
    const published: SandboxUtilityChildPayload[] = [];
    const run = createRun({
      runDirectory,
      launch: createLaunch(owned.process),
      published,
      timeoutMs: 500,
      idleTimeoutMs: 50,
    });
    const completion = run.start();
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(50);
    expect(owned.stopCount).toBe(1);
    settleOwnedProcess(owned, { exitCode: null, signal: 'SIGTERM' });
    await flushUntil(() => owned.releaseCount === 1);
    owned.releaseResult.resolve({ status: 'succeeded' });
    await completion;
    await vi.advanceTimersByTimeAsync(1_000);

    expect(owned.stopCount).toBe(1);
    expect(terminalPayload(published)?.cause).toBe('idle_timed_out');
  });

  it('owner end 与其他外部终止使用同一首次原因胜出合同', async () => {
    const runDirectory = await createRunDirectory();
    const owned = createOwnedProcess();
    const published: SandboxUtilityChildPayload[] = [];
    const run = createRun({
      runDirectory,
      launch: createLaunch(owned.process),
      published,
    });
    const completion = run.start();
    await flushMicrotasks();

    run.terminate('owner_ended');
    run.terminate('cancelled');
    run.terminate('transport_failed');
    settleOwnedProcess(owned, { exitCode: null, signal: 'SIGTERM' });
    await waitFor(() => owned.releaseCount === 1);
    owned.releaseResult.resolve({ status: 'succeeded' });
    await completion;

    expect(owned.stopCount).toBe(1);
    expect(terminalPayload(published)?.cause).toBe('owner_ended');
  });

  it('控制流损坏形成 transport failure，但仍等待 tree 与 release 后发布终态', async () => {
    const runDirectory = await createRunDirectory();
    const owned = createOwnedProcess();
    const published: SandboxUtilityChildPayload[] = [];
    const completion = createRun({
      runDirectory,
      launch: createLaunch(owned.process),
      published,
    }).start();
    await flushMicrotasks();

    owned.stdout.end('not-a-control-frame\n');
    owned.stderr.end();
    owned.rootExit.resolve({ exitCode: 1, signal: null });
    owned.rootClose.resolve();
    owned.treeEmpty.resolve({ status: 'succeeded' });
    await waitFor(() => owned.releaseCount === 1);
    expect(terminalPayload(published)).toBeUndefined();
    owned.releaseResult.resolve({ status: 'succeeded' });
    await completion;

    expect(owned.stopCount).toBe(1);
    expect(terminalPayload(published)).toMatchObject({
      cause: 'transport_failed',
      settlementFailures: ['control_stream_failed'],
    });
  });

  it('stderr 持续计量完整 byte，并且跨 chunk 只保留最后 64 KiB', async () => {
    const runDirectory = await createRunDirectory();
    const owned = createOwnedProcess();
    const published: SandboxUtilityChildPayload[] = [];
    const completion = createRun({
      runDirectory,
      launch: createLaunch(owned.process),
      published,
    }).start();
    await flushMicrotasks();

    const prefix = Buffer.alloc(4 * 1024, 0x61);
    const pressure = Buffer.alloc(70 * 1024, 0x62);
    const suffix = Buffer.from('final-tail');
    owned.stderr.write(prefix);
    owned.stderr.write(pressure);
    owned.stderr.end(suffix);

    await publishSandboxResultMailbox({
      runDirectory,
      runToken: RUN_TOKEN,
      result: successfulEvaluation(),
    });
    for (const kind of ['ready', 'started', 'result_committed'] as const) {
      owned.stdout.write(
        serializeSandboxControlFrame({
          protocol_version: 1,
          kind,
          run_token: RUN_TOKEN,
          pid: 2468,
        })
      );
      await waitFor(() =>
        published
          .filter(payload => payload.kind === 'sandbox_evaluator_frame')
          .some(payload => payload.frame === kind)
      );
    }
    owned.stdout.end();
    owned.rootExit.resolve({ exitCode: 0, signal: null });
    owned.rootClose.resolve();
    owned.treeEmpty.resolve({ status: 'succeeded' });
    await waitFor(() => owned.releaseCount === 1);
    owned.releaseResult.resolve({ status: 'succeeded' });
    await completion;

    const expectedTail = Buffer.concat([pressure, suffix])
      .subarray(-STDERR_TAIL_MAX_BYTES)
      .toString('utf8');
    expect(terminalPayload(published)).toMatchObject({
      cause: 'natural',
      stderrBytes: prefix.byteLength + pressure.byteLength + suffix.byteLength,
      stderrTail: expectedTail,
      settlementFailures: [],
    });
    expect(Buffer.byteLength(terminalPayload(published)?.stderrTail ?? '', 'utf8')).toBe(
      STDERR_TAIL_MAX_BYTES
    );
  });

  it('启动回滚不完整时同时投影 launch、tree cleanup 与 resource release 失败', async () => {
    const runDirectory = await createRunDirectory();
    const published: SandboxUtilityChildPayload[] = [];
    const launch = createRejectedLaunch(
      new OwnedPipeProcessStartupCleanupError(
        'platform startup rollback failed',
        { status: 'failed', error: new Error('tree remained alive') },
        { status: 'failed', error: new Error('native handle remained open') }
      )
    );

    await createRun({ runDirectory, launch, published }).start();

    expect(terminalPayload(published)).toMatchObject({
      cause: 'transport_failed',
      settlementFailures: ['launch_failed', 'tree_cleanup_failed', 'resource_release_failed'],
    });
  });

  it('完整 control 但 result mailbox 缺失时明确记录 mailbox 失败', async () => {
    const runDirectory = await createRunDirectory();
    const owned = createOwnedProcess();
    const published: SandboxUtilityChildPayload[] = [];
    const launch = createLaunch(owned.process);
    const completion = createRun({ runDirectory, launch, published }).start();
    await waitFor(() => launch.calls.length === 1);

    for (const kind of ['ready', 'started', 'result_committed'] as const) {
      owned.stdout.write(
        serializeSandboxControlFrame({
          protocol_version: 1,
          kind,
          run_token: RUN_TOKEN,
          pid: 2468,
        })
      );
      await waitFor(() =>
        published
          .filter(payload => payload.kind === 'sandbox_evaluator_frame')
          .some(payload => payload.frame === kind)
      );
    }
    owned.stdout.end();
    owned.stderr.end();
    owned.rootExit.resolve({ exitCode: 0, signal: null });
    owned.rootClose.resolve();
    owned.treeEmpty.resolve({ status: 'succeeded' });
    await waitFor(() => owned.releaseCount === 1);
    owned.releaseResult.resolve({ status: 'succeeded' });
    await completion;

    expect(terminalPayload(published)?.settlementFailures).toContain('result_mailbox_failed');
  });
});

function createRun(input: {
  readonly runDirectory: string;
  readonly launch: RecordedLaunch;
  readonly published: SandboxUtilityChildPayload[];
  readonly timeoutMs?: number;
  readonly idleTimeoutMs?: number;
}) {
  return runSandboxUtilityProcess({
    request: {
      runToken: RUN_TOKEN,
      runDirectory: input.runDirectory,
      timeoutMs: input.timeoutMs ?? 10_000,
      idleTimeoutMs: input.idleTimeoutMs ?? 10_000,
      maximumHeapMb: 64,
      evaluator: {
        executablePath: path.resolve('sandbox-evaluator'),
        entryPath: path.resolve('sandboxEvaluatorProcess.cjs'),
        environment: {},
      },
    },
    platform: process.platform,
    launchOwnedProcess: input.launch,
    async publish(payload) {
      input.published.push(payload);
    },
    postTreeDrainDeadlineMs: 50,
  });
}

function createLaunch(ownedProcess: OwnedPipeProcess) {
  const calls: Parameters<LaunchOwnedPipeProcess>[0][] = [];
  const signals: (AbortSignal | undefined)[] = [];
  const launch: LaunchOwnedPipeProcess = async (request, options) => {
    calls.push(request);
    signals.push(options?.abortSignal);
    return ownedProcess;
  };
  return Object.assign(launch, { calls, signals });
}

function createPendingLaunch() {
  const pending = deferred<OwnedPipeProcess>();
  const calls: Parameters<LaunchOwnedPipeProcess>[0][] = [];
  const signals: (AbortSignal | undefined)[] = [];
  const launch: LaunchOwnedPipeProcess = async (request, options) => {
    calls.push(request);
    signals.push(options?.abortSignal);
    return pending.promise;
  };
  return Object.assign(launch, { calls, signals, pending });
}

function createRejectedLaunch(error: Error): RecordedLaunch {
  const calls: Parameters<LaunchOwnedPipeProcess>[0][] = [];
  const signals: (AbortSignal | undefined)[] = [];
  const launch: LaunchOwnedPipeProcess = async (request, options) => {
    calls.push(request);
    signals.push(options?.abortSignal);
    throw error;
  };
  return Object.assign(launch, { calls, signals });
}

function settleOwnedProcess(
  owned: ReturnType<typeof createOwnedProcess>,
  rootExit: OwnedProcessRootExit
): void {
  owned.stdout.end();
  owned.stderr.end();
  owned.rootExit.resolve(rootExit);
  owned.rootClose.resolve();
  owned.treeEmpty.resolve({ status: 'succeeded' });
}

function successfulEvaluation(): SandboxRunnerEvaluationResult {
  return {
    success: true,
    value: { ok: true },
    logs: [],
    elapsedMs: 5,
    capabilityCalls: [],
    deniedActions: [],
  };
}

function terminalPayload(
  published: readonly SandboxUtilityChildPayload[]
): Extract<SandboxUtilityChildPayload, { readonly kind: 'sandbox_terminal' }> | undefined {
  const payload = published.find(entry => entry.kind === 'sandbox_terminal');
  return payload?.kind === 'sandbox_terminal' ? payload : undefined;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition was not observed before deadline');
    await new Promise(resolve => setTimeout(resolve, 1));
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function flushUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await flushMicrotasks();
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
  }
  throw new Error('condition was not observed while flushing deterministic tasks');
}
