import {
  MAX_PROCESS_OUTPUT_WAIT_TIMEOUT_MS,
  ProcessOutputCursorSchema,
  type CommandPipeOutputChannel,
  type ProcessOutputCursor,
} from '@app/schemas/commands';
import type {
  CommandOutputCurrentLogicalLineSnapshot,
} from '../../../../../domains/commands/definitions/commandOutputProjection';
import type {
  ProcessOutputObservationReadResult,
} from '../../../../../domains/commands/definitions/processOutputObservation';
import type {
  PipeCommandOutputObservationController,
  PipeCommandOutputObservationLimits,
} from '../definitions/pipeCommandOutputObservation';
import { findCommandTextUtf16SafePrefixEnd } from './findCommandTextUtf16SafeBoundary';

interface RetainedOutputEvent {
  readonly cursor: ProcessOutputCursor;
  readonly channel: CommandPipeOutputChannel;
  readonly text: string;
}

interface PendingObservationWaiter {
  readonly afterCursor: ProcessOutputCursor;
  readonly resolve: (result: ProcessOutputObservationReadResult) => void;
  readonly timer: NodeJS.Timeout;
}

const EMPTY_CURRENT_LOGICAL_LINES: Readonly<
  Record<CommandPipeOutputChannel, CommandOutputCurrentLogicalLineSnapshot>
> = Object.freeze({
  stdout: Object.freeze({ text: '', omittedCharacters: 0 }),
  stderr: Object.freeze({ text: '', omittedCharacters: 0 }),
});

function validateLimits(
  limits: PipeCommandOutputObservationLimits,
): PipeCommandOutputObservationLimits {
  if (!Number.isSafeInteger(limits.maxEvents) || limits.maxEvents <= 0) {
    throw new Error('pipe output observation maxEvents must be a positive safe integer');
  }
  if (!Number.isSafeInteger(limits.maxCharacters) || limits.maxCharacters < 2) {
    throw new Error('pipe output observation maxCharacters must be a safe integer of at least 2');
  }
  return Object.freeze({
    maxEvents: limits.maxEvents,
    maxCharacters: limits.maxCharacters,
  });
}

function validateWaitTimeout(waitTimeoutMs: number): number {
  if (
    !Number.isSafeInteger(waitTimeoutMs)
    || waitTimeoutMs <= 0
    || waitTimeoutMs > MAX_PROCESS_OUTPUT_WAIT_TIMEOUT_MS
  ) {
    throw new Error('process output wait timeout is outside the reliable timer range');
  }
  return waitTimeoutMs;
}

/**
 * 运行中查询只保留有限的稳定文本尾窗；完整正文继续由 ToolOutputStore/raw artifact 负责。
 * cursor 属于本窗口的观察版本，绝不使用“读过即删除”，否则同一对话的多个 Agent 会互相吞输出。
 */
export function createBoundedPipeCommandOutputObservation(
  rawLimits: PipeCommandOutputObservationLimits,
): PipeCommandOutputObservationController {
  const limits = validateLimits(rawLimits);
  const events: RetainedOutputEvent[] = [];
  const waiters = new Set<PendingObservationWaiter>();
  let retainedCharacters = 0;
  let currentCursor = ProcessOutputCursorSchema.parse(0);
  let discardedThroughCursor = ProcessOutputCursorSchema.parse(0);
  let currentLogicalLines = EMPTY_CURRENT_LOGICAL_LINES;
  let outputPhase: 'open' | 'closed' = 'open';
  let textProjection: 'available' | 'failed' = 'available';

  function nextCursor(): ProcessOutputCursor {
    currentCursor = ProcessOutputCursorSchema.parse(currentCursor + 1);
    return currentCursor;
  }

  function evictToLimits(): void {
    while (
      events.length > limits.maxEvents
      || retainedCharacters > limits.maxCharacters
    ) {
      const removed = events.shift();
      if (!removed) break;
      retainedCharacters -= removed.text.length;
      discardedThroughCursor = removed.cursor;
    }
  }

  function appendEvent(channel: CommandPipeOutputChannel, text: string): void {
    const cursor = nextCursor();
    events.push(Object.freeze({ cursor, channel, text }));
    retainedCharacters += text.length;
    evictToLimits();
  }

  function appendStableText(channel: CommandPipeOutputChannel, text: string): void {
    if (text.length === 0) return;
    let offset = 0;
    while (offset < text.length) {
      const accepted = findCommandTextUtf16SafePrefixEnd(
        text.slice(offset),
        limits.maxCharacters,
      );
      if (accepted <= 0) {
        throw new Error('pipe output observation character limit cannot advance');
      }
      const end = offset + accepted;
      appendEvent(channel, text.slice(offset, end));
      offset = end;
    }
  }

  function read(afterCursor: ProcessOutputCursor): ProcessOutputObservationReadResult {
    if (afterCursor > currentCursor) return { status: 'invalid_cursor' };
    const coverage = afterCursor < discardedThroughCursor ? 'omitted' as const : 'complete' as const;
    const effectiveCursor = coverage === 'omitted' ? discardedThroughCursor : afterCursor;
    let stdout = '';
    let stderr = '';
    for (const event of events) {
      if (event.cursor <= effectiveCursor) continue;
      if (event.channel === 'stdout') stdout += event.text;
      else stderr += event.text;
    }
    return Object.freeze({
      status: 'observed' as const,
      observation: Object.freeze({
        mode: 'pipe' as const,
        coverage,
        requestedCursor: afterCursor,
        availableAfterCursor: discardedThroughCursor,
        nextCursor: currentCursor,
        stdout,
        stderr,
        currentLogicalLines,
        outputPhase,
        textProjection,
      }),
    });
  }

  function wakeWaiters(): void {
    for (const waiter of Array.from(waiters)) {
      if (outputPhase === 'open' && currentCursor <= waiter.afterCursor) continue;
      waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve(read(waiter.afterCursor));
    }
  }

  function accept(input: Parameters<PipeCommandOutputObservationController['accept']>[0]): void {
    if (outputPhase === 'closed') {
      throw new Error('cannot accept pipe output observation after close');
    }
    currentLogicalLines = Object.freeze({
      stdout: Object.freeze({ ...input.currentLogicalLines.stdout }),
      stderr: Object.freeze({ ...input.currentLogicalLines.stderr }),
    });
    appendStableText(input.channel, input.stableText);
    // 即使本次只有可被 CR 覆盖的当前行，也要推进观察版本并唤醒 process wait。
    appendEvent(input.channel, '');
    wakeWaiters();
  }

  const controller: PipeCommandOutputObservationController = {
    read,
    waitForChange(input) {
      validateWaitTimeout(input.waitTimeoutMs);
      const immediate = read(input.afterCursor);
      if (
        immediate.status === 'invalid_cursor'
        || outputPhase === 'closed'
        || currentCursor > input.afterCursor
      ) {
        return Promise.resolve(immediate);
      }
      return new Promise((resolve) => {
        const waiter: PendingObservationWaiter = {
          afterCursor: input.afterCursor,
          resolve,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            resolve(read(input.afterCursor));
          }, input.waitTimeoutMs),
        };
        waiters.add(waiter);
      });
    },
    accept,
    markProjectionFailed() {
      if (outputPhase === 'closed' || textProjection === 'failed') return;
      textProjection = 'failed';
      appendEvent('stdout', '');
      wakeWaiters();
    },
    close(input) {
      if (outputPhase === 'closed') return;
      appendStableText('stdout', input.trailingStableText.stdout);
      appendStableText('stderr', input.trailingStableText.stderr);
      currentLogicalLines = EMPTY_CURRENT_LOGICAL_LINES;
      outputPhase = 'closed';
      wakeWaiters();
    },
  };
  return Object.freeze(controller);
}
