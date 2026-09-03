import { spawn, type ChildProcess } from 'node:child_process';
import { Readable, Writable } from 'node:stream';

import { OwnedPipeProcessStartupCleanupError } from '../../../../shared/process-runtime';
import type {
  LaunchOwnedPipeProcess,
  OwnedPipeProcess,
  OwnedPipeProcessLaunchOptions,
  OwnedProcessResourceReleaseResult,
  OwnedProcessRootExit,
  OwnedProcessTreeStopResult,
} from '../../../../shared/process-runtime';
import {
  signalMacOsProcessGroupIfAlive,
  waitForMacOsProcessGroupEmpty,
} from './functions/ownedMacOsProcessGroup';

const WATCHDOG_FORCE_DELAY_SECONDS = 0.4;
const WATCHDOG_TREE_DEADLINE_MS = 1_500;
const DIRECT_KILL_TREE_DEADLINE_MS = 5_000;
const OWNED_CHILD_SPAWN_DEADLINE_MS = 5_000;
const OWNED_WRAPPER_READY_DEADLINE_MS = 5_000;
const OWNED_WRAPPER_GATE_DEADLINE_MS = 5_000;
const ROOT_CLOSE_DEADLINE_MS = 5_000;

const OWNED_PROCESS_WRAPPER = `
if [[ ! -x "$1" ]]; then
  exit 126
fi
{
  exec 0<&3 3<&- 4>&- 5<&- 1>/dev/null 2>/dev/null
  trap '' TERM
  if ! IFS= read -r _; then
    kill -TERM -$$
    sleep ${WATCHDOG_FORCE_DELAY_SECONDS}
    kill -KILL -$$
  fi
} &
exec 3<&-
print -nu4 -- R
exec 4>&-
if ! IFS= read -r owner_ready <&5 || [[ "$owner_ready" != G ]]; then
  exit 125
fi
exec 5<&-
exec "$@"
`;

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => {};
  let rejectPromise: (error: Error) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function toError(error: unknown, message: string): Error {
  return error instanceof Error ? error : new Error(message);
}

function createLaunchAbortedError(): Error {
  const error = new Error('macOS process owner launch was aborted');
  error.name = 'AbortError';
  return error;
}

function throwIfLaunchAborted(options: OwnedPipeProcessLaunchOptions): void {
  if (options.abortSignal?.aborted) throw createLaunchAbortedError();
}

async function waitWithin<T>(
  promise: Promise<T>,
  deadlineMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), deadlineMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function requirePipeResources(child: ChildProcess): {
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly ownerPipe: Writable;
  readonly readyPipe: Readable;
  readonly startGate: Writable;
} {
  // Node 的 ChildProcess 类型只声明标准 fd 0-4 的固定 tuple；运行时仍会按 spawn 的
  // stdio 配置返回 fd 5。转成普通数组后逐项验证，避免用类型断言掩盖资源缺失。
  const stdio = Array.from(child.stdio);
  const stdout = child.stdout;
  const stderr = child.stderr;
  const ownerPipe = stdio[3];
  const readyPipe = stdio[4];
  const startGate = stdio[5];
  if (
    !(stdout instanceof Readable)
    || !(stderr instanceof Readable)
    || !(ownerPipe instanceof Writable)
    || !(readyPipe instanceof Readable)
    || !(startGate instanceof Writable)
  ) {
    throw new Error('macOS process owner did not receive the required pipe resources');
  }
  return { stdout, stderr, ownerPipe, readyPipe, startGate };
}

function observeRoot(child: ChildProcess): {
  readonly rootExit: Promise<OwnedProcessRootExit>;
  readonly rootClose: Promise<void>;
} {
  const rootExit = deferred<OwnedProcessRootExit>();
  const rootClose = deferred<void>();
  child.once('exit', (exitCode, signal) => rootExit.resolve({ exitCode, signal }));
  child.once('close', () => rootClose.resolve());
  return { rootExit: rootExit.promise, rootClose: rootClose.promise };
}

async function waitForOwnedChildSpawn(child: ChildProcess): Promise<number> {
  const spawned = deferred<number>();
  child.once('spawn', () => {
    const processGroupId = child.pid;
    if (!Number.isSafeInteger(processGroupId) || processGroupId === undefined || processGroupId <= 0) {
      spawned.reject(new Error('macOS process owner did not receive a root PID at spawn time'));
      return;
    }
    spawned.resolve(processGroupId);
  });
  child.once('error', error => spawned.reject(error));
  return spawned.promise;
}

async function waitForOwnedWrapperReady(input: {
  readonly child: ChildProcess;
  readonly readyPipe: Readable;
  readonly rootExit: Promise<OwnedProcessRootExit>;
}): Promise<void> {
  const ready = deferred<void>();
  let readyObserved = false;
  const failBeforeReady = (error: Error): void => {
    if (!readyObserved) ready.reject(error);
  };
  input.readyPipe.once('data', (bytes: Buffer) => {
    if (bytes.byteLength !== 1 || bytes[0] !== 0x52) {
      failBeforeReady(new Error('macOS process owner returned an invalid readiness frame'));
      return;
    }
    readyObserved = true;
    ready.resolve();
  });
  input.readyPipe.once('error', error => failBeforeReady(error));
  input.readyPipe.once('end', () => {
    failBeforeReady(new Error('macOS process owner closed before readiness'));
  });
  input.child.once('error', error => failBeforeReady(error));
  void input.rootExit.then((exit) => {
    failBeforeReady(new Error(
      `macOS process owner exited before readiness: code=${exit.exitCode ?? 'none'} `
        + `signal=${exit.signal ?? 'none'}`,
    ));
  });
  await ready.promise;
  input.readyPipe.resume();
}

async function openOwnedWrapperStartGate(startGate: Writable): Promise<void> {
  const opened = deferred<void>();
  startGate.once('error', error => opened.reject(error));
  startGate.end('G\n', () => opened.resolve());
  await opened.promise;
}

function createOwnedProcess(input: {
  readonly processGroupId: number;
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly ownerPipe: Writable;
  readonly rootExit: Promise<OwnedProcessRootExit>;
  readonly rootClose: Promise<void>;
  readonly abortSignal?: AbortSignal;
}): OwnedPipeProcess {
  let stopPromise: Promise<OwnedProcessTreeStopResult> | undefined;
  let releasePromise: Promise<OwnedProcessResourceReleaseResult> | undefined;
  const treeEmpty = deferred<OwnedProcessTreeStopResult>();
  input.ownerPipe.on('error', () => {
    // stop 会用进程组事实判断最终结果；管道错误本身不能替代 tree-empty 证明。
  });

  function stopAndWaitForTreeEmpty(): Promise<OwnedProcessTreeStopResult> {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      try {
        // 私有管道是 utility 与进程组的内核级生命线。正常停止和 utility 崩溃
        // 都形成 EOF，让同组 watchdog 执行同一条 TERM -> KILL 路径。
        input.ownerPipe.end();
        if (await waitForMacOsProcessGroupEmpty(
          input.processGroupId,
          WATCHDOG_TREE_DEADLINE_MS,
        )) {
          return { status: 'succeeded' };
        }

        signalMacOsProcessGroupIfAlive(input.processGroupId, 'SIGKILL');
        if (!await waitForMacOsProcessGroupEmpty(
          input.processGroupId,
          DIRECT_KILL_TREE_DEADLINE_MS,
        )) {
          throw new Error(`macOS process group ${input.processGroupId} did not become empty`);
        }
        return { status: 'succeeded' };
      } catch (error) {
        return {
          status: 'failed',
          error: toError(error, 'macOS process tree cleanup failed'),
        };
      }
    })();
    void stopPromise.then(result => treeEmpty.resolve(result));
    return stopPromise;
  }

  function release(): Promise<OwnedProcessResourceReleaseResult> {
    if (releasePromise) return releasePromise;
    releasePromise = (async () => {
      try {
        const treeStop = await stopAndWaitForTreeEmpty();
        if (treeStop.status === 'failed') {
          throw new Error(
            `macOS process resources cannot be released before tree cleanup: ${treeStop.error.message}`,
          );
        }
        await waitWithin(
          input.rootClose,
          ROOT_CLOSE_DEADLINE_MS,
          'macOS root process did not close before resource-release deadline',
        );
        input.ownerPipe.destroy();
        input.abortSignal?.removeEventListener('abort', stopAfterAbort);
        return { status: 'succeeded' };
      } catch (error) {
        return {
          status: 'failed',
          error: toError(error, 'macOS process owner resource release failed'),
        };
      }
    })();
    return releasePromise;
  }

  const stopAfterAbort = (): void => {
    void stopAndWaitForTreeEmpty();
  };
  input.abortSignal?.addEventListener('abort', stopAfterAbort, { once: true });
  if (input.abortSignal?.aborted) stopAfterAbort();

  // 根进程退出不代表后台后代已经结束；自然退出也必须进入同一条幂等收树链。
  void input.rootExit.then(() => stopAndWaitForTreeEmpty());

  return Object.freeze({
    stdout: input.stdout,
    stderr: input.stderr,
    rootExit: input.rootExit,
    rootClose: input.rootClose,
    treeEmpty: treeEmpty.promise,
    stopAndWaitForTreeEmpty,
    release,
  });
}

/**
 * 在 spawn 时建立并冻结独立 PGID。可信 wrapper 只负责 owner-death watchdog；用户命令
 * 通过结构化 argv 执行，且不会继承 fd 3/4/5，因此不能读取或长期持有 owner 控制管道。
 */
export const createMacOsProcessGroupOwnedPipeProcess: LaunchOwnedPipeProcess = async (
  launch,
  options = {},
) => {
  if (process.platform !== 'darwin') {
    throw new Error('macOS process-group owner is unavailable on this platform');
  }
  throwIfLaunchAborted(options);
  const child = spawn('/bin/zsh', [
    '-f',
    '-c',
    OWNED_PROCESS_WRAPPER,
    'linnya-process-owner',
    launch.executablePath,
    ...launch.argv,
  ], {
    cwd: launch.cwd,
    env: launch.environment,
    detached: true,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
  });
  const root = observeRoot(child);
  let processGroupId: number | undefined;
  let pipes: ReturnType<typeof requirePipeResources> | undefined;
  const spawnedProcessGroup = waitForOwnedChildSpawn(child);
  const startupAborted = deferred<never>();
  const abortStartup = (): void => {
    pipes?.ownerPipe.end();
    pipes?.startGate.end();
    startupAborted.reject(createLaunchAbortedError());
  };
  options.abortSignal?.addEventListener('abort', abortStartup, { once: true });
  const waitForStartupStage = <T>(
    promise: Promise<T>,
    deadlineMs: number,
    timeoutMessage: string,
  ): Promise<T> => waitWithin(
    Promise.race([promise, startupAborted.promise]),
    deadlineMs,
    timeoutMessage,
  );
  let ownedProcess: OwnedPipeProcess | undefined;
  try {
    processGroupId = await waitForStartupStage(
      spawnedProcessGroup,
      OWNED_CHILD_SPAWN_DEADLINE_MS,
      'macOS process owner spawn deadline exceeded',
    );
    // 只有 spawn 已被观察后才校验 fd，确保任何缺失资源都能按已冻结 PGID 回滚。
    pipes = requirePipeResources(child);
    throwIfLaunchAborted(options);
    await waitForStartupStage(
      waitForOwnedWrapperReady({
        child,
        readyPipe: pipes.readyPipe,
        rootExit: root.rootExit,
      }),
      OWNED_WRAPPER_READY_DEADLINE_MS,
      'macOS process owner readiness deadline exceeded',
    );
    throwIfLaunchAborted(options);
  } catch (error) {
    if (pipes) {
      pipes.ownerPipe.end();
      pipes.startGate.end();
    } else {
      // fd 准入失败时还没有可用的具名 owner pipe；关闭所有已创建的父端资源，
      // 再用 spawn-time PGID 证明 wrapper 与 watchdog 已经归零。
      for (const resource of Array.from(child.stdio)) resource?.destroy();
    }
    let treeCleanup: OwnedProcessTreeStopResult = { status: 'succeeded' };
    let resourceRelease: OwnedProcessResourceReleaseResult = { status: 'succeeded' };
    try {
      if (processGroupId === undefined) {
        try {
          processGroupId = await waitWithin(
            spawnedProcessGroup,
            OWNED_CHILD_SPAWN_DEADLINE_MS,
            'macOS startup rollback could not observe the spawned process group',
          );
        } catch {
          // spawn 自身失败时没有进程组需要清理；root close 仍在下一道屏障验证。
        }
      }
      if (
        processGroupId !== undefined
        && !await waitForMacOsProcessGroupEmpty(processGroupId, WATCHDOG_TREE_DEADLINE_MS)
      ) {
        signalMacOsProcessGroupIfAlive(processGroupId, 'SIGKILL');
        if (!await waitForMacOsProcessGroupEmpty(processGroupId, DIRECT_KILL_TREE_DEADLINE_MS)) {
          throw new Error(`macOS startup rollback left process group ${processGroupId} active`);
        }
      }
    } catch (rollbackError) {
      treeCleanup = {
        status: 'failed',
        error: toError(rollbackError, 'macOS startup tree cleanup failed'),
      };
    }
    try {
      await waitWithin(
        root.rootClose,
        ROOT_CLOSE_DEADLINE_MS,
        'macOS startup rollback did not close the root process',
      );
    } catch (rollbackError) {
      resourceRelease = {
        status: 'failed',
        error: toError(rollbackError, 'macOS startup resource release failed'),
      };
    }
    if (treeCleanup.status === 'failed' || resourceRelease.status === 'failed') {
      throw new OwnedPipeProcessStartupCleanupError(
        'macOS process owner startup rollback was incomplete',
        treeCleanup,
        resourceRelease,
        { cause: error },
      );
    }
    throw error;
  } finally {
    options.abortSignal?.removeEventListener('abort', abortStartup);
  }
  if (processGroupId === undefined) {
    throw new Error('macOS process owner group is unavailable after readiness');
  }
  if (!pipes) {
    throw new Error('macOS process owner pipes are unavailable after readiness');
  }
  ownedProcess = createOwnedProcess({
    processGroupId,
    ...pipes,
    ...root,
    abortSignal: options.abortSignal,
  });
  try {
    // startGate.end 一旦被调用，wrapper 就可能已经读取 G 并 exec 用户代码；从这一刻起，
    // abort、回调错误和超时都不能再归类为 guaranteed_not_started。
    await waitWithin(
      openOwnedWrapperStartGate(pipes.startGate),
      OWNED_WRAPPER_GATE_DEADLINE_MS,
      'macOS process owner start-gate deadline exceeded',
    );
    return ownedProcess;
  } catch (error) {
    const treeCleanup = await ownedProcess.stopAndWaitForTreeEmpty();
    const resourceRelease = await ownedProcess.release();
    throw new OwnedPipeProcessStartupCleanupError(
      'macOS process owner failed at the user-code commit point',
      treeCleanup,
      resourceRelease,
      { cause: error },
    );
  }
};
