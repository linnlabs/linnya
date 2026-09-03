import type { CommandRunnerEventV1 } from '@app/schemas/commands';

import {
  parseSerializedLocalProcessPlatformRuntime,
} from '../../../local-process-runtime/platform-runtime';
import { createCommandRunnerPlatformLauncher } from '../../platform-runtime/orchestration/createCommandRunnerPlatformLauncher';
import type { AcknowledgedCommandRunnerUtilityTransport } from '../functions/createAcknowledgedCommandRunnerUtilityTransport';
import { createAcknowledgedCommandRunnerUtilityTransport } from '../functions/createAcknowledgedCommandRunnerUtilityTransport';
import {
  parseCommandRunnerUtilityGeneration,
  parseCommandRunnerUtilityHostPayload,
  type CommandRunnerUtilityChildPayload,
} from '../definitions/commandRunnerUtilityTransport';
import {
  runCommandRunnerProcess,
} from '../orchestration/runCommandRunnerProcess';

const parentPort = process.parentPort;
if (!parentPort) throw new Error('command runner utility process requires process.parentPort');

const generation = parseCommandRunnerUtilityGeneration(process.argv[2]);
const platformLaunchers = createCommandRunnerPlatformLauncher(
  parseSerializedLocalProcessPlatformRuntime(process.argv[3]),
);
let utilityTransport: AcknowledgedCommandRunnerUtilityTransport<
  CommandRunnerUtilityChildPayload
> | undefined;

const controller = runCommandRunnerProcess({
  sendEvent(event: CommandRunnerEventV1): Promise<void> {
    if (!utilityTransport) {
      return Promise.reject(new Error('command runner utility transport is unavailable'));
    }
    return utilityTransport.send({ kind: 'command_runner_event', event });
  },
  writeDiagnostic(message) {
    process.stderr.write(`[command-runner] ${message}\n`);
  },
  finish(exitCode) {
    // owner-end 也要先让当前 ACK 离开调用栈；同步 exit 会把已接纳控制帧伪造成发送失败。
    process.exitCode = exitCode;
    setImmediate(() => process.exit(exitCode));
  },
}, platformLaunchers);

// Electron 37+ 不再因未处理 rejection 自动让 Utility Process 崩溃。
// 入口必须把它归入既有 transport failure 编排，等待业务进程和终态收口后非零退出。
process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  process.stderr.write(`[command-runner] unhandled rejection: ${message}\n`);
  controller.transportFailed('command runner utility encountered an unhandled rejection');
});

utilityTransport = createAcknowledgedCommandRunnerUtilityTransport({
  generation,
  postMessage: envelope => parentPort.postMessage(envelope),
  parseIncomingPayload: parseCommandRunnerUtilityHostPayload,
  acceptIncomingPayload(payload) {
    if (payload.kind === 'command_runner_owner_end') controller.ownerEnded();
    else controller.acceptRequest(payload.request);
  },
  onFailure() {
    controller.transportFailed('command runner utility transport failed');
  },
});

parentPort.on('message', event => utilityTransport?.receive(event.data));

void utilityTransport.send({ kind: 'command_runner_ready' }).catch(() => {
  controller.transportFailed('command runner utility ready acknowledgement failed');
});
