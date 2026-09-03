import { execFile } from 'node:child_process';
import { constants, writeSync } from 'node:fs';
import { mkdtemp, open, rm, type FileHandle } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';

import { SandboxManager } from '@anthropic-ai/sandbox-runtime';
import type {
  CommandPermissionLevel,
  ProcessInteractionActionV1,
} from '@app/schemas/commands';
import { spawn, type IPty } from 'node-pty';

import type {
  OwnedPipeProcessLaunchOptions,
  OwnedProcessResourceReleaseResult,
  OwnedProcessRootExit,
  OwnedProcessTreeStopResult,
} from '../../../../shared/process-runtime';
import type {
  OwnedPtyCommandProcess,
  OwnedPtyCommandProcessLaunch,
} from '../runner/definitions/ownedPtyCommandProcess';
import { OwnedPtyCommandProcessStartupCleanupError } from '../runner/definitions/ownedPtyCommandProcess';
import { createMacOsCommandFilesystemPolicy } from './functions/createMacOsCommandFilesystemPolicy';
import {
  signalMacOsProcessGroupIfAlive,
  waitForMacOsProcessGroupEmpty,
} from '../../local-process-runtime/macos';
import { serializePosixCommandArgv } from './functions/serializePosixCommandArgv';

const execFileAsync = promisify(execFile);
const WATCHDOG_FORCE_DELAY_SECONDS = 0.4;
const WATCHDOG_TREE_DEADLINE_MS = 1_500;
const DIRECT_KILL_TREE_DEADLINE_MS = 5_000;
const START_GATE_DEADLINE_MS = 5_000;
const RELEASE_DEADLINE_MS = 5_000;
const GATE_OPEN_POLL_MS = 10;

const OWNED_PTY_WRAPPER = `
if [[ ! -x "$3" ]]; then
  exit 126
fi
exec 3<"$1"
{
  exec </dev/null >/dev/null 2>/dev/null
  trap '' TERM
  if ! IFS= read -r _ <&3; then
    kill -TERM -$$
    sleep ${WATCHDOG_FORCE_DELAY_SECONDS}
    kill -KILL -$$
  fi
} &
exec 3<&-
if ! IFS= read -r owner_ready <"$2" || [[ "$owner_ready" != G ]]; then
  exit 125
fi
shift 2
exec "$@"
`;

export interface MacOsSandboxedOwnedPtyCommandProcessLaunch
  extends OwnedPtyCommandProcessLaunch {
  readonly permissionLevel: CommandPermissionLevel;
  readonly conversationRoot: string;
}

export class MacOsOwnedPtyCommandProcessLaunchError extends Error {
  readonly cause?: unknown;

  constructor(
    readonly stage: 'sandbox' | 'process_owner',
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message);
    this.name = 'MacOsOwnedPtyCommandProcessLaunchError';
    this.cause = options?.cause;
  }
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly settled: boolean;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let settled = false;
  let resolvePromise: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    get settled() {
      return settled;
    },
    resolve(value) {
      if (settled) return;
      settled = true;
      resolvePromise(value);
    },
  };
}

function toError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function createAbortError(): Error {
  const error = new Error('macOS PTY process owner launch was aborted');
  error.name = 'AbortError';
  return error;
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

async function createOwnerFifos(): Promise<{
  readonly root: string;
  readonly ownerPath: string;
  readonly gatePath: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'linnya-command-pty-'));
  const ownerPath = path.join(root, 'owner.fifo');
  const gatePath = path.join(root, 'gate.fifo');
  try {
    await execFileAsync('/usr/bin/mkfifo', ['-m', '600', ownerPath, gatePath]);
    return { root, ownerPath, gatePath };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

async function openStartGateWriter(
  gatePath: string,
  abortSignal?: AbortSignal,
): Promise<FileHandle> {
  const deadline = Date.now() + START_GATE_DEADLINE_MS;
  while (Date.now() < deadline) {
    if (abortSignal?.aborted) throw createAbortError();
    try {
      return await open(gatePath, constants.O_WRONLY | constants.O_NONBLOCK);
    } catch (error) {
      if (!isErrorCode(error, 'ENXIO')) throw error;
    }
    await new Promise<void>(resolve => setTimeout(resolve, GATE_OPEN_POLL_MS));
  }
  throw new Error('macOS PTY owner did not reach its start gate');
}

async function openStartGateBeforeOwnerTerminal(input: {
  readonly gatePath: string;
  readonly owner: OwnedPtyCommandProcess;
  readonly abortSignal?: AbortSignal;
}): Promise<FileHandle> {
  const gateAbort = new AbortController();
  const abortFromCaller = (): void => gateAbort.abort();
  input.abortSignal?.addEventListener('abort', abortFromCaller, { once: true });
  if (input.abortSignal?.aborted) gateAbort.abort();
  const gateWriter = openStartGateWriter(input.gatePath, gateAbort.signal);
  try {
    return await Promise.race([
      gateWriter,
      input.owner.rootExit.then((exit) => {
        throw new Error(
          `macOS PTY process owner exited before its start gate: code=${String(exit.exitCode)}`,
        );
      }),
      input.owner.backendFailure.then((error) => {
        throw error;
      }),
    ]);
  } catch (error) {
    gateAbort.abort();
    // poll 可能恰在 root exit 前打开 writer；此时也必须关闭，不能让迟到 gate handle
    // 延长启动失败的资源生命周期。
    await gateWriter.then(writer => writer.close(), () => undefined);
    throw error;
  } finally {
    input.abortSignal?.removeEventListener('abort', abortFromCaller);
  }
}

async function prepareInvocation(
  launch: MacOsSandboxedOwnedPtyCommandProcessLaunch,
  abortSignal?: AbortSignal,
): Promise<{ readonly executablePath: string; readonly argv: readonly string[]; readonly sandboxed: boolean }> {
  if (launch.permissionLevel === 'full_access') {
    return {
      executablePath: launch.executablePath,
      argv: launch.argv,
      sandboxed: false,
    };
  }
  const dependencies = await SandboxManager.checkDependenciesAsync();
  if (dependencies.errors.length > 0) {
    throw new Error(
      `macOS sandbox dependencies are unavailable: ${dependencies.errors.join(', ')}`,
    );
  }
  const descriptor = await SandboxManager.wrapWithSandboxArgv(
    serializePosixCommandArgv(launch.executablePath, launch.argv),
    '/bin/zsh',
    {
      filesystem: createMacOsCommandFilesystemPolicy(launch),
      // PTY 在 sandbox-exec 外创建并不够：交互 CLI 仍要对 slave TTY 执行
      // termios ioctl。没有这项时 isTTY 为真，但 readline/raw mode 会报 EPERM。
      allowPty: true,
    },
    abortSignal,
    launch.cwd,
  );
  const [executablePath, ...argv] = descriptor.argv;
  if (!executablePath) throw new Error('macOS sandbox returned an empty launch argv');
  return { executablePath, argv, sandboxed: true };
}

function createTerminalReadable(input: {
  readonly pty: IPty;
  readonly rootExit: Deferred<OwnedProcessRootExit>;
  readonly backendFailure: Deferred<Error>;
}): { readonly stream: Readable; readonly dispose: () => void } {
  let ended = false;
  let disposed = false;
  const stream = new Readable({
    read() {
      input.pty.resume();
    },
  });
  const fail = (error: Error): void => {
    input.backendFailure.resolve(error);
    // backendFailure 是正式错误通道；Readable 在交给 runner 前尚未必有 error listener。
    // 这里只结束 transcript，避免同一个平台错误再变成未处理的 stream error。
    if (!ended) {
      ended = true;
      stream.destroy();
    }
  };
  input.pty.on('error', fail);
  const dataDisposable = input.pty.onData((data: unknown) => {
    if (!Buffer.isBuffer(data)) {
      fail(new Error('macOS node-pty delivered non-byte terminal transcript'));
      return;
    }
    if (!stream.push(Buffer.from(data))) input.pty.pause();
  });
  const exitDisposable = input.pty.onExit((event) => {
    input.rootExit.resolve({
      exitCode: event.exitCode,
      signal: event.signal && event.signal > 0 ? `signal:${event.signal}` : null,
    });
    if (!ended) {
      ended = true;
      stream.push(null);
    }
  });
  return {
    stream,
    dispose() {
      if (disposed) return;
      disposed = true;
      dataDisposable.dispose();
      exitDisposable.dispose();
      input.pty.removeListener('error', fail);
      if (!ended) {
        ended = true;
        stream.destroy();
      }
    },
  };
}

function createOwnedProcess(input: {
  readonly pty: IPty;
  readonly processGroupId: number;
  readonly ownerWriter: FileHandle;
  readonly resourceRoot: string;
  readonly sandboxed: boolean;
  readonly options: OwnedPipeProcessLaunchOptions;
}): OwnedPtyCommandProcess {
  const rootExit = deferred<OwnedProcessRootExit>();
  const backendFailure = deferred<Error>();
  const treeEmpty = deferred<OwnedProcessTreeStopResult>();
  const terminal = createTerminalReadable({ pty: input.pty, rootExit, backendFailure });
  let acceptingInput = true;
  let stopPromise: Promise<OwnedProcessTreeStopResult> | undefined;
  let releasePromise: Promise<OwnedProcessResourceReleaseResult> | undefined;

  function stopAndWaitForTreeEmpty(): Promise<OwnedProcessTreeStopResult> {
    if (stopPromise) return stopPromise;
    acceptingInput = false;
    stopPromise = (async () => {
      try {
        await input.ownerWriter.close();
        if (!await waitForMacOsProcessGroupEmpty(
          input.processGroupId,
          WATCHDOG_TREE_DEADLINE_MS,
        )) {
          signalMacOsProcessGroupIfAlive(input.processGroupId, 'SIGKILL');
          if (!await waitForMacOsProcessGroupEmpty(
            input.processGroupId,
            DIRECT_KILL_TREE_DEADLINE_MS,
          )) {
            throw new Error(
              `macOS PTY process group ${input.processGroupId} did not become empty`,
            );
          }
        }
        return { status: 'succeeded' as const };
      } catch (error) {
        return {
          status: 'failed' as const,
          error: toError(error, 'macOS PTY process tree cleanup failed'),
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
        const stopped = await stopAndWaitForTreeEmpty();
        if (stopped.status === 'failed') throw stopped.error;
        await waitWithin(
          rootExit.promise,
          RELEASE_DEADLINE_MS,
          'macOS PTY root/terminal did not close after tree cleanup',
        );
        await rm(input.resourceRoot, { recursive: true, force: true });
        if (input.sandboxed) await SandboxManager.reset();
        return { status: 'succeeded' as const };
      } catch (error) {
        return {
          status: 'failed' as const,
          error: toError(error, 'macOS PTY resource release failed'),
        };
      } finally {
        // release 已经接管 terminal 的最终所有权。即使树清理、deadline 或 sandbox reset
        // 失败，也不能把 node-pty listener、Readable 和 AbortSignal listener 留给宿主。
        terminal.dispose();
        input.options.abortSignal?.removeEventListener('abort', stopAfterAbort);
      }
    })();
    void releasePromise.then((result) => {
      // reset/deadline 等失败可能在资源所有权未被消耗时恢复；不能用旧 Promise 永久锁死
      // release。terminal.dispose 是幂等的，重试不会重新开放输入或 transcript。
      if (result.status === 'failed') releasePromise = undefined;
    });
    return releasePromise;
  }

  void rootExit.promise.then(() => stopAndWaitForTreeEmpty());
  void backendFailure.promise.then(() => stopAndWaitForTreeEmpty());
  const stopAfterAbort = (): void => {
    void stopAndWaitForTreeEmpty();
  };
  input.options.abortSignal?.addEventListener('abort', stopAfterAbort, { once: true });
  if (input.options.abortSignal?.aborted) stopAfterAbort();

  return Object.freeze({
    terminal: terminal.stream,
    rootExit: rootExit.promise,
    treeEmpty: treeEmpty.promise,
    backendFailure: backendFailure.promise,
    async interact(action: ProcessInteractionActionV1): Promise<void> {
      if (!acceptingInput) throw new Error('macOS PTY input is closed');
      try {
        switch (action.type) {
          case 'write':
            input.pty.write(action.input);
            return;
          case 'submit':
            input.pty.write(`${action.input}\r`);
            return;
          case 'eof':
            input.pty.write('\x04');
            return;
          case 'resize':
            input.pty.resize(action.columns, action.rows);
            return;
        }
      } catch (error) {
        const failure = toError(error, 'macOS PTY interaction failed');
        backendFailure.resolve(failure);
        throw failure;
      }
    },
    stopAndWaitForTreeEmpty,
    release,
  });
}

async function failAfterOwnerAdmission(input: {
  readonly owner: OwnedPtyCommandProcess;
  readonly gateWriter?: FileHandle;
  readonly originalError: unknown;
}): Promise<never> {
  let launchError = input.originalError;
  try {
    await input.gateWriter?.close();
  } catch (gateError) {
    launchError = {
      launchError,
      gateCloseError: gateError,
    };
  }
  const treeCleanup = await input.owner.stopAndWaitForTreeEmpty();
  const resourceRelease = await input.owner.release();
  throw new OwnedPtyCommandProcessStartupCleanupError(
    'macOS PTY process owner failed before delivery',
    treeCleanup,
    resourceRelease,
    { cause: launchError },
  );
}

async function cleanupBeforeOwnerAdmission(input: {
  readonly resourcesRoot?: string;
  readonly ownerWriter?: FileHandle;
  readonly gateWriter?: FileHandle;
  readonly pty?: IPty;
  readonly sandboxed: boolean;
}): Promise<readonly Error[]> {
  const failures: Error[] = [];
  const attempt = async (operation: () => void | Promise<void>, message: string): Promise<void> => {
    try {
      await operation();
    } catch (error) {
      failures.push(toError(error, message));
    }
  };
  await attempt(() => input.gateWriter?.close(), 'macOS PTY start gate cleanup failed');
  await attempt(() => input.ownerWriter?.close(), 'macOS PTY owner channel cleanup failed');
  if (input.pty) {
    const pty = input.pty;
    await attempt(() => pty.kill('SIGKILL'), 'macOS PTY backend cleanup failed');
  }
  if (input.resourcesRoot) {
    const resourcesRoot = input.resourcesRoot;
    await attempt(
      () => rm(resourcesRoot, { recursive: true, force: true }),
      'macOS PTY temporary resource cleanup failed',
    );
  }
  if (input.sandboxed) {
    await attempt(() => SandboxManager.reset(), 'macOS PTY sandbox reset failed');
  }
  return failures;
}

/**
 * node-pty 会在 forkpty child 中关闭继承 fd，所以不能复用普通 pipe 的匿名 owner fd。
 * 这里用本次唯一 FIFO 作为内核生命线：utility 死亡会关闭唯一 writer，沙箱内 watchdog
 * 观察 EOF 后终止冻结 PGID。用户命令只在 gate writer 成功握手后才会 exec。
 */
export async function createMacOsSandboxedOwnedPtyCommandProcess(
  launch: MacOsSandboxedOwnedPtyCommandProcessLaunch,
  options: OwnedPipeProcessLaunchOptions = {},
): Promise<OwnedPtyCommandProcess> {
  if (process.platform !== 'darwin') {
    throw new MacOsOwnedPtyCommandProcessLaunchError(
      'process_owner',
      'macOS PTY process owner cannot run on another platform',
    );
  }
  if (options.abortSignal?.aborted) throw createAbortError();

  let invocation: Awaited<ReturnType<typeof prepareInvocation>>;
  try {
    invocation = await prepareInvocation(launch, options.abortSignal);
  } catch (error) {
    try {
      await SandboxManager.reset();
    } catch (resetError) {
      throw new MacOsOwnedPtyCommandProcessLaunchError(
        'sandbox',
        'macOS PTY sandbox preparation and reset both failed',
        { cause: { preparationError: error, resetError } },
      );
    }
    throw new MacOsOwnedPtyCommandProcessLaunchError(
      'sandbox',
      'macOS PTY sandbox preparation failed',
      { cause: error },
    );
  }

  let resources: Awaited<ReturnType<typeof createOwnerFifos>> | undefined;
  let ownerWriter: FileHandle | undefined;
  let gateWriter: FileHandle | undefined;
  let pty: IPty | undefined;
  let owner: OwnedPtyCommandProcess | undefined;
  try {
    resources = await createOwnerFifos();
    ownerWriter = await open(
      resources.ownerPath,
      constants.O_RDWR | constants.O_NONBLOCK,
    );
    if (options.abortSignal?.aborted) throw createAbortError();
    pty = spawn('/bin/zsh', [
      '-f',
      '-c',
      OWNED_PTY_WRAPPER,
      'linnya-command-pty-owner',
      resources.ownerPath,
      resources.gatePath,
      invocation.executablePath,
      ...invocation.argv,
    ], {
      cols: launch.terminalSize.columns,
      rows: launch.terminalSize.rows,
      cwd: launch.cwd,
      env: { ...launch.environment, TERM: 'xterm-256color' },
      encoding: null,
    });
    if (!Number.isSafeInteger(pty.pid) || pty.pid <= 0) {
      throw new Error('macOS node-pty did not return a valid process-group identity');
    }
    // spawn 后不跨过任何 await 就建立 backend error/output/exit 观察，避免用户命令
    // 尚未放行时已经失败，却没有 owner 能完成整树清理与资源结算。
    owner = createOwnedProcess({
      pty,
      processGroupId: pty.pid,
      ownerWriter,
      resourceRoot: resources.root,
      sandboxed: invocation.sandboxed,
      options,
    });
    gateWriter = await openStartGateBeforeOwnerTerminal({
      gatePath: resources.gatePath,
      owner,
      abortSignal: options.abortSignal,
    });
    if (options.abortSignal?.aborted) throw createAbortError();
    // watchdog 与 gate 已各自持有打开的 FIFO 后，路径本身不再有生命周期价值。
    // 放行前立即 unlink，Utility 即使随后 SIGKILL 也不会在 /tmp 留下孤儿目录；
    // 已打开的内核 channel 会继续工作，且其他进程无法再通过路径加入生命线。
    await rm(resources.root, { recursive: true, force: true });
    // 两个 byte 的同步可信 gate 写入不能与 AbortSignal callback 交错；返回后用户命令
    // 才可能 exec，之后的 owner end 按正常整树停止处理。
    writeSync(gateWriter.fd, Buffer.from('G\n'));
    await gateWriter.close();
    gateWriter = undefined;
    return owner;
  } catch (error) {
    if (owner) {
      return failAfterOwnerAdmission({ owner, gateWriter, originalError: error });
    }
    const cleanupFailures = await cleanupBeforeOwnerAdmission({
      resourcesRoot: resources?.root,
      ownerWriter,
      gateWriter,
      pty,
      sandboxed: invocation.sandboxed,
    });
    throw new MacOsOwnedPtyCommandProcessLaunchError(
      'process_owner',
      'macOS PTY process owner launch failed',
      {
        cause: cleanupFailures.length === 0
          ? error
          : { launchError: error, cleanupFailures },
      },
    );
  }
}
