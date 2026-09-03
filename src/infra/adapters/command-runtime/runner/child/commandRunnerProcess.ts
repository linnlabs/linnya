import type { CommandRunnerEventV1 } from '@app/schemas/commands';

import {
  parseSerializedLocalProcessPlatformRuntime,
} from '../../../local-process-runtime/platform-runtime';
import { createCommandRunnerPlatformLauncher } from '../../platform-runtime/orchestration/createCommandRunnerPlatformLauncher';
import {
  runCommandRunnerProcess,
} from '../orchestration/runCommandRunnerProcess';

function sendRunnerEvent(event: CommandRunnerEventV1): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (typeof process.send !== 'function' || !process.connected) {
      reject(new Error('command runner IPC channel is unavailable'));
      return;
    }
    try {
      process.send(event, (error: Error | null) => {
        if (error) reject(error);
        else resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

const platformLaunchers = createCommandRunnerPlatformLauncher(
  parseSerializedLocalProcessPlatformRuntime(process.argv[2]),
);
const controller = runCommandRunnerProcess({
  sendEvent: sendRunnerEvent,
  writeDiagnostic(message) {
    process.stderr.write(`[command-runner] ${message}\n`);
  },
  finish(exitCode) {
    process.exitCode = exitCode;
    if (process.connected) process.disconnect();
  },
}, platformLaunchers);

process.on('message', controller.acceptRequest);
process.once('disconnect', controller.ownerEnded);
