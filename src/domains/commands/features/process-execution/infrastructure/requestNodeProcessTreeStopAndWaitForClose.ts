import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

const DEFAULT_STOP_PHASE_TIMEOUT_MS = 2_000;

export type NodeProcessTreeStopErrorCode =
  | 'child_close_timed_out'
  | 'posix_group_signal_failed'
  | 'windows_system_root_unavailable'
  | 'windows_terminator_launch_failed'
  | 'windows_terminator_timed_out'
  | 'windows_terminator_failed';

export class NodeProcessTreeStopError extends Error {
  readonly name = 'NodeProcessTreeStopError';

  constructor(
    readonly code: NodeProcessTreeStopErrorCode,
    message: string,
    readonly cause?: unknown,
    readonly platformExitCode?: number | null,
  ) {
    super(message);
  }
}

interface ChildCloseObservation {
  wait(timeoutMs: number): Promise<void>;
}

function observeChildClose(child: ChildProcess): ChildCloseObservation {
  let closed = false;
  const closePromise = new Promise<void>(resolve => {
    child.once('close', () => {
      closed = true;
      resolve();
    });
  });
  return {
    async wait(timeoutMs): Promise<void> {
      if (closed) return;
      let timeout: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          closePromise,
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => reject(new NodeProcessTreeStopError(
              'child_close_timed_out',
              `Command ChildProcess did not close within ${timeoutMs} ms after stop`,
            )), timeoutMs);
          }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    },
  };
}

type SpawnTerminator = (
  executablePath: string,
  argv: readonly string[],
  environment: Readonly<Record<string, string>>,
) => ChildProcess;

interface NodeProcessTreeStopDependencies {
  readonly platform?: NodeJS.Platform;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly phaseTimeoutMs?: number;
  readonly signalProcessGroup?: (processGroupId: number) => void;
  readonly spawnTerminator?: SpawnTerminator;
}

function resolveWindowsSystemRoot(
  environment: Readonly<Record<string, string | undefined>>,
): readonly [name: string, value: string] {
  const systemRootEntry = Object.entries(environment).find(([key]) => (
    key.toLowerCase() === 'systemroot'
  ));
  const systemRoot = systemRootEntry?.[1];
  if (!systemRootEntry || !systemRoot || !path.win32.isAbsolute(systemRoot)) {
    throw new NodeProcessTreeStopError(
      'windows_system_root_unavailable',
      'Windows SystemRoot is unavailable',
    );
  }
  return Object.freeze([systemRootEntry[0], systemRoot]);
}

async function runWindowsTerminator(input: {
  readonly pid: number;
  readonly executablePath: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly spawnTerminator: SpawnTerminator;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let terminator: ChildProcess;
    try {
      terminator = input.spawnTerminator(
        input.executablePath,
        ['/pid', String(input.pid), '/T', '/F'],
        input.environment,
      );
    } catch (cause: unknown) {
      reject(new NodeProcessTreeStopError(
        'windows_terminator_launch_failed',
        'Windows process-tree terminator could not start',
        cause,
      ));
      return;
    }
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    const complete = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      settle();
    };
    const fail = (error: NodeProcessTreeStopError): void => {
      complete(() => reject(error));
    };
    terminator.once('error', error => {
      fail(new NodeProcessTreeStopError(
        'windows_terminator_launch_failed',
        'Windows process-tree terminator could not start',
        error,
      ));
    });
    terminator.once('close', exitCode => {
      if (settled) return;
      if (exitCode !== 0) {
        fail(new NodeProcessTreeStopError(
          'windows_terminator_failed',
          `Windows process-tree terminator exited with code ${exitCode ?? 'unknown'}`,
          undefined,
          exitCode,
        ));
        return;
      }
      complete(resolve);
    });
    timeout = setTimeout(() => {
      if (settled) return;
      // 系统终止器本身也可能卡住；这里只请求结束它并准确失败，不能继续等待而卡死原取消。
      terminator.kill('SIGKILL');
      fail(new NodeProcessTreeStopError(
        'windows_terminator_timed_out',
        `Windows process-tree terminator did not close within ${input.timeoutMs} ms`,
      ));
    }, input.timeoutMs);
  });
}

/**
 * 请求当前平台停止已知进程树，并有界等待根 ChildProcess 发布 close。
 *
 * 这是 Plugin CLI 的过渡实现：成功只证明平台 primitive 已接受请求，
 * 且根进程的 stdio/句柄已关闭；它不能证明主动 setsid/breakaway 且不继承 pipe 的后代
 * 已经消失。对话删除和未来 Shell 必须等待正式 owner 的 tree-empty 证明。
 */
export function createNodeProcessTreeStopRequest(
  dependencies: NodeProcessTreeStopDependencies = {},
): (child: ChildProcess) => Promise<void> {
  const platform = dependencies.platform ?? process.platform;
  const environment = dependencies.environment ?? process.env;
  const phaseTimeoutMs = dependencies.phaseTimeoutMs ?? DEFAULT_STOP_PHASE_TIMEOUT_MS;
  const signalProcessGroup = dependencies.signalProcessGroup ?? (processGroupId => {
    process.kill(-processGroupId, 'SIGKILL');
  });
  const spawnTerminator = dependencies.spawnTerminator ?? ((executablePath, argv, helperEnvironment) => (
    spawn(executablePath, [...argv], {
      env: { ...helperEnvironment },
      stdio: 'ignore',
      windowsHide: true,
    })
  ));

  return async (child: ChildProcess): Promise<void> => {
    const close = observeChildClose(child);
    const pid = child.pid;
    if (pid === undefined) {
      // spawn error 后仍会发布 close；有界等待可确保异常 runtime 不会永久卡住调用方。
      await close.wait(phaseTimeoutMs);
      return;
    }
    if (platform === 'win32') {
      const [systemRootName, systemRoot] = resolveWindowsSystemRoot(environment);
      await runWindowsTerminator({
        pid,
        executablePath: path.win32.join(systemRoot, 'System32', 'taskkill.exe'),
        environment: Object.freeze({ [systemRootName]: systemRoot }),
        timeoutMs: phaseTimeoutMs,
        spawnTerminator,
      });
      await close.wait(phaseTimeoutMs);
      return;
    }

    try {
      signalProcessGroup(pid);
    } catch (cause: unknown) {
      if (!(cause instanceof Error && 'code' in cause && cause.code === 'ESRCH')) {
        throw new NodeProcessTreeStopError(
          'posix_group_signal_failed',
          'POSIX command process group could not be stopped',
          cause,
        );
      }
    }
    await close.wait(phaseTimeoutMs);
  };
}

export const requestNodeProcessTreeStopAndWaitForClose = createNodeProcessTreeStopRequest();
