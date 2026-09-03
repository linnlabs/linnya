import type { Readable } from 'node:stream';

import type {
  LaunchOwnedPipeProcess,
  OwnedPipeProcess,
  OwnedProcessRootExit,
} from '../../../../../shared/process-runtime/index.js';
import {
  OwnedPipeProcessStartupCleanupError,
} from '../../../../../shared/process-runtime/index.js';
import type {
  SandboxControlProtocolSnapshot,
} from '../definitions/sandboxControlProtocol.js';
import {
  buildSandboxEvaluatorInvocationArgv,
} from '../definitions/sandboxEvaluatorInvocation.js';
import type {
  SandboxUtilityChildPayload,
  SandboxEvaluatorLaunch,
  SandboxUtilitySettlementFailure,
  SandboxUtilityTerminationCause,
} from '../definitions/sandboxUtilityTransport.js';
import {
  createSandboxControlFrameStateMachine,
} from '../functions/createSandboxControlFrameStateMachine.js';
import { readSandboxResultMailbox } from '../functions/sandboxMailboxFiles.js';

const SANDBOX_STDERR_TAIL_MAX_BYTES = 64 * 1024;
const SANDBOX_POST_TREE_DRAIN_DEADLINE_MS = 2_000;

interface SandboxUtilityStartRequest {
  readonly runToken: string;
  readonly runDirectory: string;
  readonly timeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly maximumHeapMb: number;
  readonly evaluator: SandboxEvaluatorLaunch;
}

export interface SandboxUtilityProcessRun {
  start(): Promise<void>;
  terminate(cause: Exclude<SandboxUtilityTerminationCause, 'natural'>): void;
}

interface PromiseFact<T> {
  readonly status: 'succeeded' | 'failed';
  readonly value?: T;
}

/**
 * 编排一条 Utility-owned Sandbox run。平台 adapter 独占 spawn/kill/tree/release；这里
 * 只把互不等价的生命周期事实结算为一个 terminal，禁止用 root exit 冒充整树已空。
 */
export function runSandboxUtilityProcess(input: {
  readonly request: SandboxUtilityStartRequest;
  readonly platform: NodeJS.Platform;
  readonly launchOwnedProcess: LaunchOwnedPipeProcess;
  readonly publish: (payload: SandboxUtilityChildPayload) => Promise<void>;
  readonly postTreeDrainDeadlineMs?: number;
}): SandboxUtilityProcessRun {
  const postTreeDrainDeadlineMs = input.postTreeDrainDeadlineMs
    ?? SANDBOX_POST_TREE_DRAIN_DEADLINE_MS;
  const abortController = new AbortController();
  const settlementFailures = new Set<SandboxUtilitySettlementFailure>();
  let terminationCause: Exclude<SandboxUtilityTerminationCause, 'natural'> | undefined;
  let process: OwnedPipeProcess | undefined;
  let started = false;
  let settled = false;
  let stopPromise: Promise<void> | undefined;
  let timeoutTimer: NodeJS.Timeout | undefined;
  let idleTimer: NodeJS.Timeout | undefined;
  let stderrBytes = 0;
  let stderrTail = Buffer.alloc(0);
  let controlSnapshot: SandboxControlProtocolSnapshot = Object.freeze({
    acceptedFrames: Object.freeze([]),
    windowsCrLfPreambleObserved: false,
    completed: false,
  });

  function recordFailure(failure: SandboxUtilitySettlementFailure): void {
    settlementFailures.add(failure);
  }

  function resetIdleTimer(): void {
    if (idleTimer) clearTimeout(idleTimer);
    if (controlSnapshot.completed || settled) return;
    idleTimer = setTimeout(() => terminate('idle_timed_out'), input.request.idleTimeoutMs);
  }

  function armExecutionTimeout(): void {
    if (timeoutTimer || terminationCause || settled) return;
    // VM 的 timeout 从 Evaluator 确认 started 后计算。Utility 的外层期限只是给 VM
    // 结果提交留出宽限，不能把 Electron/Job 的冷启动时间算进用户代码预算。
    timeoutTimer = setTimeout(() => terminate('timed_out'), input.request.timeoutMs);
  }

  function completeExecutionDeadline(): void {
    if (!timeoutTimer) return;
    clearTimeout(timeoutTimer);
    timeoutTimer = undefined;
  }

  function terminate(cause: Exclude<SandboxUtilityTerminationCause, 'natural'>): void {
    if (settled || terminationCause) return;
    terminationCause = cause;
    abortController.abort();
    void stopOwnedProcess();
  }

  function stopOwnedProcess(): Promise<void> {
    if (stopPromise) return stopPromise;
    const ownedProcess = process;
    if (!ownedProcess) return Promise.resolve();
    stopPromise = ownedProcess.stopAndWaitForTreeEmpty().then(
      result => {
        if (result.status === 'failed') recordFailure('tree_cleanup_failed');
      },
      () => { recordFailure('tree_cleanup_failed'); },
    );
    return stopPromise;
  }

  function observeStderr(stream: Readable): Promise<void> {
    return new Promise(resolve => {
      let completed = false;
      const settle = (failed: boolean): void => {
        if (completed) return;
        completed = true;
        if (failed) {
          recordFailure('stderr_stream_failed');
          terminate('transport_failed');
        }
        resolve();
      };
      stream.on('data', (chunk: Buffer) => {
        const bytes = Buffer.from(chunk);
        stderrBytes += bytes.byteLength;
        if (bytes.byteLength >= SANDBOX_STDERR_TAIL_MAX_BYTES) {
          stderrTail = Buffer.from(bytes.subarray(-SANDBOX_STDERR_TAIL_MAX_BYTES));
          return;
        }
        const retainedPrefix = stderrTail.subarray(
          Math.max(0, stderrTail.byteLength + bytes.byteLength - SANDBOX_STDERR_TAIL_MAX_BYTES),
        );
        stderrTail = Buffer.concat([retainedPrefix, bytes]);
      });
      stream.once('end', () => settle(false));
      stream.once('error', () => settle(true));
      stream.once('close', () => settle(!stream.readableEnded));
      stream.resume();
    });
  }

  async function observeControl(stream: Readable): Promise<void> {
    const machine = createSandboxControlFrameStateMachine({
      platform: input.platform,
      runToken: input.request.runToken,
    });
    try {
      for await (const chunk of stream) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const frames = machine.accept(bytes);
        controlSnapshot = machine.snapshot();
        for (const frame of frames) {
          if (frame.kind === 'started') armExecutionTimeout();
          if (frame.kind === 'result_committed') {
            // 原子结果已经提交后，剩余工作是退出、整树清理和资源释放。它们各自由
            // owner/host 的结算期限监督，不能再用用户代码期限改写已完成的结果。
            completeExecutionDeadline();
          }
          resetIdleTimer();
          await input.publish({
            kind: 'sandbox_evaluator_frame',
            runToken: input.request.runToken,
            frame: frame.kind,
            evaluatorPid: frame.pid,
          });
        }
      }
      controlSnapshot = machine.finish();
    } catch {
      recordFailure('control_stream_failed');
      terminate('transport_failed');
    }
  }

  async function publishTerminal(rootExit?: OwnedProcessRootExit): Promise<void> {
    await input.publish({
      kind: 'sandbox_terminal',
      runToken: input.request.runToken,
      cause: terminationCause ?? 'natural',
      ...(rootExit ? { rootExit } : {}),
      control: controlSnapshot,
      stderrBytes,
      stderrTail: stderrTail.toString('utf8'),
      settlementFailures: Object.freeze([...settlementFailures]),
    });
  }

  async function start(): Promise<void> {
    if (started) throw new Error('sandbox utility run can only start once');
    started = true;
    resetIdleTimer();

    try {
      if (terminationCause) {
        await publishTerminal();
        return;
      }
      try {
        process = await input.launchOwnedProcess({
          executablePath: input.request.evaluator.executablePath,
          argv: buildSandboxEvaluatorInvocationArgv({
            entryPath: input.request.evaluator.entryPath,
            runToken: input.request.runToken,
            maximumHeapMb: input.request.maximumHeapMb,
          }),
          cwd: input.request.runDirectory,
          environment: input.request.evaluator.environment,
        }, { abortSignal: abortController.signal });
      } catch (error) {
        if (!terminationCause) {
          terminationCause = 'transport_failed';
          recordFailure('launch_failed');
        }
        // 平台可能在交付 owner 前已经创建过进程或原生句柄。启动失败不能把回滚失败
        // 压扁成一个 launch_failed，否则上层会误以为没有遗留进程树或资源。
        if (error instanceof OwnedPipeProcessStartupCleanupError) {
          if (error.treeCleanup.status === 'failed') recordFailure('tree_cleanup_failed');
          if (error.resourceRelease.status === 'failed') recordFailure('resource_release_failed');
        }
        await publishTerminal();
        return;
      }

      if (terminationCause) void stopOwnedProcess();
      const ownedProcess = process;
      const controlTask = observeControl(ownedProcess.stdout);
      const stderrTask = observeStderr(ownedProcess.stderr);
      const rootExitFact = observePromise(ownedProcess.rootExit);
      const rootCloseFact = observePromise(ownedProcess.rootClose);
      void rootExitFact.then(fact => {
        if (fact.status === 'failed') {
          recordFailure('root_exit_failed');
          terminate('transport_failed');
        }
      });
      void rootCloseFact.then(fact => {
        if (fact.status === 'failed') {
          recordFailure('root_close_failed');
          terminate('transport_failed');
        }
      });

      const treeFact = await observePromise(ownedProcess.treeEmpty);
      if (treeFact.status === 'failed' || treeFact.value?.status === 'failed') {
        recordFailure('tree_empty_failed');
      }
      await settleStreamsAfterTree({
        streams: [ownedProcess.stdout, ownedProcess.stderr],
        settlements: [controlTask, stderrTask],
        deadlineMs: postTreeDrainDeadlineMs,
      });

      const releaseFact = await observePromise(ownedProcess.release());
      if (releaseFact.status === 'failed' || releaseFact.value?.status === 'failed') {
        recordFailure('resource_release_failed');
      }
      const [rootExit, rootClose] = await Promise.all([rootExitFact, rootCloseFact]);
      if (rootExit.status === 'failed') recordFailure('root_exit_failed');
      if (rootClose.status === 'failed') recordFailure('root_close_failed');

      if (controlSnapshot.completed) {
        try {
          await readSandboxResultMailbox({
            runDirectory: input.request.runDirectory,
            runToken: input.request.runToken,
          });
        } catch {
          recordFailure('result_mailbox_failed');
        }
      }
      await publishTerminal(rootExit.status === 'succeeded' ? rootExit.value : undefined);
    } finally {
      settled = true;
      completeExecutionDeadline();
      if (idleTimer) clearTimeout(idleTimer);
    }
  }

  return Object.freeze({ start, terminate });
}

async function observePromise<T>(promise: Promise<T>): Promise<PromiseFact<T>> {
  try {
    return { status: 'succeeded', value: await promise };
  } catch {
    return { status: 'failed' };
  }
}

async function settleStreamsAfterTree(input: {
  readonly streams: readonly Readable[];
  readonly settlements: readonly Promise<void>[];
  readonly deadlineMs: number;
}): Promise<void> {
  let deadline: NodeJS.Timeout | undefined;
  await Promise.race([
    Promise.all(input.settlements),
    new Promise<void>(resolve => {
      deadline = setTimeout(() => {
        for (const stream of input.streams) stream.destroy();
        resolve();
      }, input.deadlineMs);
    }),
  ]);
  if (deadline) clearTimeout(deadline);
  await Promise.all(input.settlements);
}
