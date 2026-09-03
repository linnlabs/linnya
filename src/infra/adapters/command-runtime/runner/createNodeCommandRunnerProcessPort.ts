import { fork, type ForkOptions } from 'node:child_process';
import path from 'node:path';

import type { CommandRunnerRequestV1 } from '@app/schemas/commands';
import type {
  CommandRunnerProcessHandlers,
  CommandRunnerProcessPort,
} from '../../../../domains/commands';
import type {
  LocalProcessPlatformRuntime,
} from '../../local-process-runtime/platform-runtime';
import {
  serializeLocalProcessPlatformRuntime,
} from '../../local-process-runtime/platform-runtime';

export function createNodeCommandRunnerProcessPort(input: {
  readonly runnerPath: string;
  readonly nodeExecutablePath: string;
  readonly helperEnvironment: Readonly<Record<string, string>>;
  readonly platformRuntime: LocalProcessPlatformRuntime;
}): CommandRunnerProcessPort {
  if (!path.isAbsolute(input.runnerPath)) {
    throw new Error('command runner path must be absolute');
  }
  if (!path.isAbsolute(input.nodeExecutablePath)) {
    throw new Error('command runner Node executable path must be absolute');
  }
  const runnerPath = input.runnerPath;
  const nodeExecutablePath = input.nodeExecutablePath;
  const helperEnvironment = Object.freeze({ ...input.helperEnvironment });
  const serializedPlatformRuntime = serializeLocalProcessPlatformRuntime(
    input.platformRuntime,
  );

  return Object.freeze({
    fork(handlers: CommandRunnerProcessHandlers) {
      const options = {
        execPath: nodeExecutablePath,
        // Electron/开发宿主可能带 inspect、loader 或 preload；内部 helper 必须从干净 Node 启动。
        execArgv: [],
        env: { ...helperEnvironment },
        serialization: 'advanced',
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      } satisfies ForkOptions & { readonly windowsHide: boolean };
      const child = fork(runnerPath, [serializedPlatformRuntime], options);
      let closed = false;

      child.on('message', handlers.onMessage);
      child.stderr?.on('data', (chunk: Buffer) => {
        handlers.onDiagnostic(new Uint8Array(
          chunk.buffer,
          chunk.byteOffset,
          chunk.byteLength,
        ));
      });
      child.stderr?.once('error', handlers.onError);
      child.once('disconnect', handlers.onDisconnect);
      child.once('error', handlers.onError);
      child.once('close', () => {
        closed = true;
        handlers.onClose();
      });

      return Object.freeze({
        send(request: CommandRunnerRequestV1) {
          return new Promise<void>((resolve, reject) => {
            if (closed || !child.connected) {
              reject(new Error('command runner IPC channel is unavailable'));
              return;
            }
            child.send(request, (error) => {
              if (error) reject(error);
              else resolve();
            });
          });
        },
        disconnect() {
          if (!closed && child.connected) child.disconnect();
        },
        kill() {
          if (!closed) child.kill('SIGKILL');
        },
      });
    },
  });
}
