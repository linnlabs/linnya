import type { CommandRunnerRequestV1 } from '@app/schemas/commands';
import type { CommandRunnerProcessControl, CommandRunnerProcessHandlers } from '../../../../domains/commands';
import {
  createAcknowledgedCommandRunnerUtilityTransport,
  type AcknowledgedCommandRunnerUtilityTransport,
} from '../../../../infra/adapters/command-runtime/runner/functions/createAcknowledgedCommandRunnerUtilityTransport';
import {
  parseCommandRunnerUtilityChildPayload,
  type CommandRunnerUtilityGeneration,
  type CommandRunnerUtilityHostPayload,
} from '../../../../infra/adapters/command-runtime/runner/definitions/commandRunnerUtilityTransport';

export interface CommandRunnerUtilityProcessLike {
  readonly stderr: NodeJS.ReadableStream | null;
  postMessage(message: unknown): void;
  kill(): boolean;
  onMessage(listener: (message: unknown) => void): void;
  onceExit(listener: (exitCode: number) => void): void;
  onceError(listener: (type: 'FatalError', location: string, report: string) => void): void;
}

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

/**
 * utility stderr 在 Windows 不保证完整或发出 EOF，因此只转发已有诊断 byte；
 * 业务终态只来自 transport event 与 utility exit，不能等待诊断流关闭。
 */
export function createUtilityProcessTransport(input: {
  readonly child: CommandRunnerUtilityProcessLike;
  readonly generation: CommandRunnerUtilityGeneration;
  readonly handlers: CommandRunnerProcessHandlers;
  readonly acknowledgementDeadlineMs?: number;
}): CommandRunnerProcessControl {
  const ready = deferred<void>();
  // fork 后即使上层在 send 前失败，也不能产生未处理 rejection。
  void ready.promise.catch(() => undefined);
  let readyAccepted = false;
  let closed = false;
  let ownerEndSent = false;
  let fatalErrorPublished = false;
  let transport: AcknowledgedCommandRunnerUtilityTransport<
    CommandRunnerUtilityHostPayload
  >;

  function publishFatalError(error: Error): void {
    if (fatalErrorPublished || closed) return;
    fatalErrorPublished = true;
    ready.reject(error);
    input.handlers.onError(error);
  }

  function failAndTerminate(error: Error): void {
    publishFatalError(error);
    if (!closed) input.child.kill();
  }

  transport = createAcknowledgedCommandRunnerUtilityTransport({
    generation: input.generation,
    postMessage: envelope => input.child.postMessage(envelope),
    parseIncomingPayload: parseCommandRunnerUtilityChildPayload,
    acceptIncomingPayload(payload) {
      if (payload.kind === 'command_runner_ready') {
        if (readyAccepted) throw new Error('command runner utility published ready more than once');
        readyAccepted = true;
        ready.resolve();
        return;
      }
      if (!readyAccepted) {
        throw new Error('command runner utility published an event before ready');
      }
      input.handlers.onMessage(payload.event);
    },
    onFailure: failAndTerminate,
    acknowledgementDeadlineMs: input.acknowledgementDeadlineMs,
  });

  input.child.onMessage(message => transport.receive(message));
  input.child.onceError((type, location) => {
    publishFatalError(new Error(
      `command runner utility process fatal error: ${type} at ${location}`,
    ));
  });
  input.child.onceExit((exitCode) => {
    if (closed) return;
    closed = true;
    const error = new Error(`command runner utility process exited: ${exitCode}`);
    transport.close(error);
    ready.reject(error);
    // UtilityProcess 没有 disconnect 事件；exit 时按现有 port 顺序投影 disconnect -> close。
    input.handlers.onDisconnect();
    input.handlers.onClose();
  });

  let diagnosticAvailable = input.child.stderr !== null;
  input.child.stderr?.on('data', (chunk: Buffer) => {
    if (!diagnosticAvailable) return;
    input.handlers.onDiagnostic(new Uint8Array(
      chunk.buffer,
      chunk.byteOffset,
      chunk.byteLength,
    ));
  });
  input.child.stderr?.once('error', () => {
    diagnosticAvailable = false;
  });

  return Object.freeze({
    async send(request: CommandRunnerRequestV1): Promise<void> {
      await ready.promise;
      await transport.send({ kind: 'command_runner_request', request });
    },
    disconnect() {
      if (closed || ownerEndSent) return;
      ownerEndSent = true;
      // utility 没有 channel.disconnect；显式 owner-end 必须先被 child ACK，再由 runner 自行收口。
      void ready.promise
        .then(() => transport.send({ kind: 'command_runner_owner_end' }))
        .catch((error: unknown) => {
          failAndTerminate(error instanceof Error ? error : new Error(String(error)));
        });
    },
    kill() {
      if (closed) return;
      if (!input.child.kill()) {
        publishFatalError(new Error('command runner utility process kill was rejected'));
      }
    },
  });
}
