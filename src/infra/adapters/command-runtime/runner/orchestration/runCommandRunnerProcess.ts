import {
  hasSameCommandExecutionIdentity,
  parseCommandRunnerRequest,
  type CommandRunnerInteractionId,
  type CommandRunnerRequestV1,
  type PipeCommandLaunchSnapshotV1,
  type PtyCommandLaunchSnapshotV1,
} from '@app/schemas/commands';

import type {
  CommandRunnerProcessController,
  CommandRunnerProcessRuntimeTransport,
} from '../definitions/commandRunnerProcessRuntime';
import type { LaunchCommandRunnerOwnedPipeProcess } from '../definitions/commandRunnerOwnedPipeProcess';
import {
  CommandRunnerOwnedPtyProcessLaunchError,
  type LaunchCommandRunnerOwnedPtyProcess,
} from '../definitions/commandRunnerOwnedPtyProcess';
import { createBoundedCommandRunnerEventTransport } from '../functions/createBoundedCommandRunnerEventTransport';
import {
  createDisposablePipeCommandRun,
  type DisposablePipeCommandRun,
} from './createDisposablePipeCommandRun';
import {
  createDisposablePtyCommandRun,
  type DisposablePtyCommandRun,
} from './createDisposablePtyCommandRun';

const MAX_RUNNER_DIAGNOSTIC_CHARACTERS = 4_096;

type PipeCommandRunnerStartRequest = Omit<
  Extract<CommandRunnerRequestV1, { readonly kind: 'command_runner_start' }>,
  'launch'
> & { readonly launch: PipeCommandLaunchSnapshotV1 };

type PtyCommandRunnerStartRequest = Omit<
  Extract<CommandRunnerRequestV1, { readonly kind: 'command_runner_start' }>,
  'launch'
> & { readonly launch: PtyCommandLaunchSnapshotV1 };

function isPipeCommandRunnerStartRequest(
  request: Extract<CommandRunnerRequestV1, { readonly kind: 'command_runner_start' }>,
): request is PipeCommandRunnerStartRequest {
  return request.launch.mode === 'pipe';
}

function isPtyCommandRunnerStartRequest(
  request: Extract<CommandRunnerRequestV1, { readonly kind: 'command_runner_start' }>,
): request is PtyCommandRunnerStartRequest {
  return request.launch.mode === 'pty';
}

type DisposableCommandRun = DisposablePipeCommandRun | DisposablePtyCommandRun;

export interface CommandRunnerProcessLaunchers {
  readonly launchOwnedPipeProcess: LaunchCommandRunnerOwnedPipeProcess;
  readonly launchOwnedPtyProcess: LaunchCommandRunnerOwnedPtyProcess;
}

/**
 * 组合根尚未提供 PTY backend 时也必须显式注入拒绝 launcher。这样 PTY 请求会得到
 * 稳定 runtime_unavailable，且永远不会因为缺依赖而误走普通 pipe。
 */
export const rejectUnavailableCommandRunnerPtyLaunch: LaunchCommandRunnerOwnedPtyProcess = (
  async () => {
    throw new CommandRunnerOwnedPtyProcessLaunchError(
      'runtime_unavailable',
      'PTY command runtime is unavailable',
      { status: 'guaranteed_not_started' },
    );
  }
);

/**
 * Node child 与 Electron utility child 只负责传输差异，命令生命周期必须共用这一份编排。
 * 否则 drain、取消或终态修复会变成两套平台补丁，重新引入平行 runner。
 */
export function runCommandRunnerProcess(
  transport: CommandRunnerProcessRuntimeTransport,
  launchers: CommandRunnerProcessLaunchers,
): CommandRunnerProcessController {
  let activeRun: DisposableCommandRun | undefined;
  let activeStart: Promise<void> | undefined;
  let activeRequest: PipeCommandRunnerStartRequest | PtyCommandRunnerStartRequest | undefined;
  let lastInteractionId: CommandRunnerInteractionId | undefined;
  let protocolFailureStarted = false;
  let finishStarted = false;

  function writeRunnerDiagnostic(message: string): void {
    transport.writeDiagnostic(message.slice(0, MAX_RUNNER_DIAGNOSTIC_CHARACTERS));
  }

  function finishRunner(exitCode: number): void {
    if (finishStarted) return;
    finishStarted = true;
    transport.finish(exitCode);
  }

  async function failProtocol(message: string): Promise<void> {
    if (protocolFailureStarted || finishStarted) return;
    protocolFailureStarted = true;
    writeRunnerDiagnostic(message);
    activeRun?.stop('owner_ended');
    if (activeStart) {
      try {
        await activeStart;
      } catch {
        // start 已负责收口业务进程；协议失败只等待资源 owner，原始传输错误由 host 观察。
      }
    }
    finishRunner(1);
  }

  function beginRun(
    request: PipeCommandRunnerStartRequest | PtyCommandRunnerStartRequest,
  ): void {
    if (activeRequest) {
      void failProtocol('received more than one start request');
      return;
    }
    activeRequest = request;
    const events = createBoundedCommandRunnerEventTransport({ send: transport.sendEvent });
    activeRun = isPipeCommandRunnerStartRequest(request)
      ? createDisposablePipeCommandRun({
          request,
          events,
          launchOwnedProcess: launchers.launchOwnedPipeProcess,
        })
      : createDisposablePtyCommandRun({
          request,
          events,
          launchOwnedProcess: launchers.launchOwnedPtyProcess,
        });
    activeStart = activeRun.start();
    void activeStart.then(
      () => finishRunner(protocolFailureStarted ? 1 : 0),
      () => {
        writeRunnerDiagnostic('runtime event channel failed while the command was active');
        finishRunner(1);
      },
    );
  }

  function interactWithRun(
    request: Extract<CommandRunnerRequestV1, { readonly kind: 'command_runner_interaction' }>,
  ): void {
    if (!activeRequest || !activeRun) {
      void failProtocol('received an interaction request before start');
      return;
    }
    if (!hasSameCommandExecutionIdentity(
      request.identity,
      activeRequest.launch.proposal.identity,
    )) {
      void failProtocol('received an interaction request for a different command execution');
      return;
    }
    if (!isPtyCommandRunnerStartRequest(activeRequest) || !('interact' in activeRun)) {
      void failProtocol('pipe command runner received an interaction request');
      return;
    }
    if (lastInteractionId !== undefined && request.interaction_id <= lastInteractionId) {
      void failProtocol('received a non-monotonic interaction identity');
      return;
    }
    lastInteractionId = request.interaction_id;
    void activeRun.interact(request.interaction_id, request.action).catch(() => {
      void failProtocol('runtime event channel failed while publishing an interaction result');
    });
  }

  function stopRun(
    request: Extract<CommandRunnerRequestV1, { readonly kind: 'command_runner_stop' }>,
  ): void {
    if (!activeRequest || !activeRun) {
      void failProtocol('received a stop request before start');
      return;
    }
    if (!hasSameCommandExecutionIdentity(
      request.identity,
      activeRequest.launch.proposal.identity,
    )) {
      void failProtocol('received a stop request for a different command execution');
      return;
    }
    activeRun.stop(request.cause);
  }

  return Object.freeze({
    acceptRequest(rawRequest: unknown) {
      if (protocolFailureStarted || finishStarted) return;
      let request: CommandRunnerRequestV1;
      try {
        request = parseCommandRunnerRequest(rawRequest);
      } catch {
        void failProtocol('received an invalid runner request');
        return;
      }
      if (request.kind === 'command_runner_start') {
        if (!isPipeCommandRunnerStartRequest(request) && !isPtyCommandRunnerStartRequest(request)) {
          void failProtocol('received an unsupported command launch mode');
          return;
        }
        beginRun(request);
        return;
      }
      if (request.kind === 'command_runner_stop') {
        stopRun(request);
        return;
      }
      interactWithRun(request);
    },

    ownerEnded() {
      if (finishStarted) return;
      if (activeRun) activeRun.stop('owner_ended');
      else finishRunner(0);
    },

    transportFailed(message: string) {
      void failProtocol(message);
    },
  });
}
