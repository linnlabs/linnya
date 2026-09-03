import { fork, type ChildProcess, type ForkOptions } from 'node:child_process';
import path from 'node:path';

import type {
  SandboxUtilityProcessForkPort,
  SandboxUtilityProcessForkRequest,
} from 'src/app-hosts/linnya/adapters/sandbox/production-runtime';

export function createNodeSandboxUtilityProcessFork(input: {
  readonly nodeExecutablePath: string;
}): SandboxUtilityProcessForkPort {
  if (!path.isAbsolute(input.nodeExecutablePath)) {
    throw new Error('sandbox utility Node executable path must be absolute');
  }
  const nodeExecutablePath = input.nodeExecutablePath;

  return Object.freeze({
    fork(request: SandboxUtilityProcessForkRequest) {
      if (!path.isAbsolute(request.utilityPath)) {
        throw new Error('sandbox utility process path must be absolute');
      }
      const options = {
        execPath: nodeExecutablePath,
        execArgv: [],
        env: { ...request.environment },
        serialization: 'advanced',
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      } satisfies ForkOptions & { readonly windowsHide: boolean };
      const child = fork(request.utilityPath, [...request.argv], options);
      return projectNodeSandboxUtilityProcess(child);
    },
  });
}

function projectNodeSandboxUtilityProcess(child: ChildProcess) {
  let errorListener: ((error: Error) => void) | undefined;
  let pendingError: Error | undefined;
  let errorPublished = false;

  const publishError = (error: Error): void => {
    if (errorPublished) return;
    errorPublished = true;
    if (errorListener) errorListener(error);
    else pendingError = error;
  };
  child.once('error', publishError);

  return Object.freeze({
    stderr: child.stderr,
    postMessage(message: unknown): void {
      if (!child.connected) {
        throw new Error('sandbox utility Node IPC channel is unavailable');
      }
      if (!isNodeIpcSerializable(message)) {
        throw new Error('sandbox utility host attempted to send a non-serializable root value');
      }
      child.send(message, error => {
        if (error) publishError(error);
      });
    },
    kill(): boolean {
      return child.kill('SIGKILL');
    },
    onMessage(listener: (message: unknown) => void): void {
      child.on('message', listener);
    },
    onceExit(listener: (exitCode: number) => void): void {
      child.once('exit', exitCode => listener(exitCode ?? 1));
    },
    onceError(listener: (error: Error) => void): void {
      errorListener = listener;
      if (pendingError) {
        const error = pendingError;
        pendingError = undefined;
        queueMicrotask(() => listener(error));
      }
    },
  });
}

function isNodeIpcSerializable(
  value: unknown,
): value is string | object | number | boolean | bigint {
  return value !== null && (
    typeof value === 'object'
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
    || typeof value === 'bigint'
  );
}
