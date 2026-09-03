import {
  parseCommandRunnerEvent,
  type CommandRunnerEventV1,
} from '@app/schemas/commands';

import type {
  CommandRunnerEventSendOperation,
  CommandRunnerEventTransport,
  CommandRunnerOutputEventV1,
  CommandRunnerOutputTransportLimits,
} from '../definitions/commandRunnerOutputTransport';
import { DEFAULT_COMMAND_RUNNER_OUTPUT_TRANSPORT_LIMITS } from '../definitions/commandRunnerOutputTransport';

interface PendingOutputEvent {
  readonly event: CommandRunnerOutputEventV1;
  readonly byteLength: number;
}

function isCommandRunnerOutputEvent(
  event: CommandRunnerEventV1,
): event is CommandRunnerOutputEventV1 {
  return event.kind === 'command_runner_output'
    || event.kind === 'command_runner_pty_output';
}

function validateLimits(
  limits: CommandRunnerOutputTransportLimits,
): CommandRunnerOutputTransportLimits {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`command runner output transport ${name} must be a positive safe integer`);
    }
  }
  return Object.freeze({
    maxPendingEvents: limits.maxPendingEvents,
    maxPendingBytes: limits.maxPendingBytes,
  });
}

/**
 * 每次只把一个 event 交给 Node IPC；callback 返回前仍计入预算。这样 process.send
 * 内部不会先堆出一条不可观察的无界队列，runner 也能在 host 变慢时继续读取系统 pipe。
 */
export function createBoundedCommandRunnerEventTransport(input: {
  readonly send: CommandRunnerEventSendOperation;
  readonly limits?: CommandRunnerOutputTransportLimits;
}): CommandRunnerEventTransport {
  const limits = validateLimits(
    input.limits ?? DEFAULT_COMMAND_RUNNER_OUTPUT_TRANSPORT_LIMITS,
  );
  const queue: PendingOutputEvent[] = [];
  let pendingEvents = 0;
  let pendingBytes = 0;
  let pumpPromise: Promise<void> | undefined;
  let controlTail: Promise<void> = Promise.resolve();
  let firstFailure: unknown;

  function fits(byteLength: number): boolean {
    return pendingEvents < limits.maxPendingEvents
      && byteLength <= limits.maxPendingBytes - pendingBytes;
  }

  function stopAfterFailure(error: unknown): void {
    firstFailure ??= error;
    for (const pending of queue.splice(0)) {
      pendingEvents -= 1;
      pendingBytes -= pending.byteLength;
    }
  }

  async function pump(): Promise<void> {
    while (queue.length > 0 && firstFailure === undefined) {
      const pending = queue.shift();
      if (!pending) break;
      try {
        await input.send(pending.event);
      } catch (error) {
        stopAfterFailure(error);
      } finally {
        pendingEvents -= 1;
        pendingBytes -= pending.byteLength;
      }
    }
  }

  function schedulePump(): void {
    if (pumpPromise || firstFailure !== undefined || queue.length === 0) return;
    pumpPromise = Promise.resolve()
      .then(() => pump())
      .finally(() => {
        pumpPromise = undefined;
        if (queue.length > 0 && firstFailure === undefined) schedulePump();
      });
  }

  async function flush(): Promise<void> {
    schedulePump();
    await pumpPromise;
    if (firstFailure !== undefined) throw firstFailure;
  }

  return {
    offerOutput(rawEvent) {
      if (firstFailure !== undefined) return { status: 'unavailable' };
      const parsed = parseCommandRunnerEvent(rawEvent);
      if (!isCommandRunnerOutputEvent(parsed)) {
        throw new Error('command runner output transport only accepts output events');
      }
      if (!fits(parsed.bytes.byteLength)) return { status: 'overloaded' };

      // advanced IPC 仍是异步发送；必须切断 Node Buffer 复用和大 backing buffer view。
      const event = parseCommandRunnerEvent({
        ...parsed,
        bytes: Uint8Array.from(parsed.bytes),
      });
      if (!isCommandRunnerOutputEvent(event)) {
        throw new Error('command runner output event changed kind during ownership transfer');
      }
      queue.push({ event, byteLength: event.bytes.byteLength });
      pendingEvents += 1;
      pendingBytes += event.bytes.byteLength;
      schedulePump();
      return { status: 'accepted' };
    },

    sendControl(rawEvent) {
      const event = parseCommandRunnerEvent(rawEvent);
      if (isCommandRunnerOutputEvent(event)) {
        throw new Error('command runner control transport cannot send output events');
      }
      // started、交互结果和 terminal 都共享这条顺序链。只分别 flush output 会让两个
      // 并发 control 同时进入底层 IPC，terminal 可能越过已经产生的交互结果。
      const operation = controlTail.then(async () => {
        await flush();
        try {
          await input.send(event);
        } catch (error) {
          firstFailure ??= error;
          throw error;
        }
      });
      controlTail = operation.then(() => undefined, () => undefined);
      return operation;
    },
  };
}
