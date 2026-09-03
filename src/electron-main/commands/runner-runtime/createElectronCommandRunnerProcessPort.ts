import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { app, utilityProcess, type ForkOptions } from 'electron';

import type {
  CommandRunnerProcessHandlers,
  CommandRunnerProcessPort,
} from '../../../domains/commands';
import { parseCommandRunnerUtilityGeneration } from '../../../infra/adapters/command-runtime/runner/definitions/commandRunnerUtilityTransport';
import type {
  LocalProcessPlatformRuntime,
} from '../../../infra/adapters/local-process-runtime/platform-runtime';
import {
  serializeLocalProcessPlatformRuntime,
} from '../../../infra/adapters/local-process-runtime/platform-runtime';
import { createUtilityProcessTransport } from './functions/createUtilityProcessTransport';

export function createElectronCommandRunnerProcessPort(input: {
  readonly runnerPath: string;
  readonly helperEnvironment: Readonly<Record<string, string>>;
  readonly platformRuntime: LocalProcessPlatformRuntime;
}): CommandRunnerProcessPort {
  if (!path.isAbsolute(input.runnerPath)) {
    throw new Error('command runner utility path must be absolute');
  }
  const runnerPath = input.runnerPath;
  const helperEnvironment = Object.freeze({ ...input.helperEnvironment });
  const serializedPlatformRuntime = serializeLocalProcessPlatformRuntime(
    input.platformRuntime,
  );

  return Object.freeze({
    fork(handlers: CommandRunnerProcessHandlers) {
      if (!app.isReady()) {
        throw new Error('command runner utility process requires Electron app ready');
      }
      const generation = parseCommandRunnerUtilityGeneration(randomUUID());
      const options = {
        env: { ...helperEnvironment },
        execArgv: [],
        serviceName: 'Linnya Command Runner',
        stdio: ['ignore', 'ignore', 'pipe'],
      } satisfies ForkOptions;
      const child = utilityProcess.fork(runnerPath, [
        generation,
        serializedPlatformRuntime,
      ], options);
      return createUtilityProcessTransport({
        child: {
          stderr: child.stderr,
          postMessage: message => child.postMessage(message),
          kill: () => child.kill(),
          onMessage: listener => { child.on('message', listener); },
          onceExit: listener => { child.once('exit', listener); },
          onceError: listener => { child.once('error', listener); },
        },
        generation,
        handlers,
      });
    },
  });
}
