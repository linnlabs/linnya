import { spawn, type ChildProcess } from 'node:child_process';
import {
  CommandExecutionError,
  type CommandLaunchSpec,
  type CommandProcessResult,
} from '../../../definitions/commandExecution';
import type { CommandProcessPort } from '../../../ports/commandProcessPort';
import {
  requestNodeProcessTreeStopAndWaitForClose,
} from './requestNodeProcessTreeStopAndWaitForClose';

function chunkToBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }
  return Buffer.from(String(chunk), 'utf8');
}

interface NodeCommandProcessDependencies {
  readonly now?: () => number;
  readonly spawnChild?: typeof spawn;
  readonly requestProcessTreeStopAndWaitForClose?: (child: ChildProcess) => Promise<void>;
}

export function createNodeCommandProcess(
  dependencies: NodeCommandProcessDependencies = {},
): CommandProcessPort {
  const now = dependencies.now ?? Date.now;
  const spawnChild = dependencies.spawnChild ?? spawn;
  const requestProcessTreeStopAndWaitForClose =
    dependencies.requestProcessTreeStopAndWaitForClose
    ?? requestNodeProcessTreeStopAndWaitForClose;
  return {
    execute(
      spec: CommandLaunchSpec,
      options: { readonly abortSignal?: AbortSignal } = {},
    ): Promise<CommandProcessResult> {
      if (options.abortSignal?.aborted) {
        return Promise.reject(new CommandExecutionError(
          'command.execution.cancelled',
          'Command execution was cancelled',
        ));
      }

      return new Promise<CommandProcessResult>((resolve, reject) => {
        const startedAt = now();
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let settled = false;
        let timeout: NodeJS.Timeout | undefined;

        if (options.abortSignal?.aborted) {
          reject(new CommandExecutionError(
            'command.execution.cancelled',
            'Command execution was cancelled',
          ));
          return;
        }

        let child: ChildProcess;
        try {
          child = spawnChild(spec.executablePath, [...spec.argv], {
            cwd: spec.cwd,
            env: { ...spec.environment },
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
            // POSIX 下独立进程组是可靠终止 CLI renderer/helper 后代的前提。
            detached: process.platform !== 'win32',
          });
        } catch (cause: unknown) {
          reject(new CommandExecutionError(
            'command.execution.launch_failed',
            'Command process could not be launched',
            cause,
          ));
          return;
        }

        const cleanup = (): void => {
          if (timeout) {
            clearTimeout(timeout);
          }
          options.abortSignal?.removeEventListener('abort', onAbort);
        };
        let requestedFailure: CommandExecutionError | undefined;
        const fail = (error: CommandExecutionError): void => {
          if (settled) return;
          if (requestedFailure) return;
          requestedFailure = error;
          cleanup();
          void requestProcessTreeStopAndWaitForClose(child).then(
            () => {
              if (settled) return;
              settled = true;
              reject(error);
            },
            (cause: unknown) => {
              if (settled) return;
              settled = true;
              reject(new CommandExecutionError(
                'command.execution.termination_failed',
                'Command process tree could not be confirmed stopped',
                { requestedFailure: error, stopFailure: cause },
              ));
            },
          );
        };
        const onAbort = (): void => {
          fail(new CommandExecutionError(
            'command.execution.cancelled',
            'Command execution was cancelled',
          ));
        };
        const collect = (
          target: Buffer[],
          chunk: unknown,
          currentBytes: number,
          limit: number,
          streamName: 'stdout' | 'stderr',
        ): number => {
          // 停止已经开始后仍保留 data listener 排空系统 pipe，但不再累计进程输出。
          if (requestedFailure) return currentBytes;
          const buffer = chunkToBuffer(chunk);
          const nextBytes = currentBytes + buffer.byteLength;
          if (nextBytes > limit) {
            fail(new CommandExecutionError(
              'command.execution.output_limit_exceeded',
              `Command ${streamName} exceeded its registered byte limit`,
            ));
            return currentBytes;
          }
          target.push(buffer);
          return nextBytes;
        };

        child.stdout?.on('data', (chunk: unknown) => {
          stdoutBytes = collect(stdout, chunk, stdoutBytes, spec.maxStdoutBytes, 'stdout');
        });
        child.stderr?.on('data', (chunk: unknown) => {
          stderrBytes = collect(stderr, chunk, stderrBytes, spec.maxStderrBytes, 'stderr');
        });
        child.once('error', (cause: Error) => {
          fail(new CommandExecutionError(
            'command.execution.launch_failed',
            'Command process could not be launched',
            cause,
          ));
        });
        child.once('close', (exitCode, signal) => {
          if (settled) return;
          if (requestedFailure) return;
          settled = true;
          cleanup();
          resolve({
            exitCode,
            signal,
            stdout: Buffer.concat(stdout).toString('utf8'),
            stderr: Buffer.concat(stderr).toString('utf8'),
            durationMs: Math.max(0, now() - startedAt),
          });
        });

        timeout = setTimeout(() => {
          fail(new CommandExecutionError(
            'command.execution.timed_out',
            'Command execution exceeded its registered timeout',
          ));
        }, spec.timeoutMs);
        options.abortSignal?.addEventListener('abort', onAbort, { once: true });
        // 初次检查后到 listener 注册前仍有竞态窗口，因此注册后必须补读一次。
        if (options.abortSignal?.aborted) {
          onAbort();
        }
      });
    },
  };
}
