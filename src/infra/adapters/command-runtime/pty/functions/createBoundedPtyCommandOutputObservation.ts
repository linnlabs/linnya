import {
  MAX_PROCESS_OUTPUT_WAIT_TIMEOUT_MS,
  ProcessOutputCursorSchema,
  type ProcessOutputCursor,
} from '@app/schemas/commands';
import type {
  CommandOutputTextPreview,
  ProcessOutputObservationReadResult,
  PtyTerminalScreenProjection,
} from '../../../../../domains/commands';
import { createBoundedCommandTextProjection } from '../../output';
import type {
  PtyCommandOutputObservationController,
  PtyCommandOutputObservationLimits,
} from '../definitions/ptyCommandOutputObservation';

interface RetainedScreenSnapshot {
  readonly cursor: ProcessOutputCursor;
  readonly terminal: CommandOutputTextPreview;
  readonly screen: PtyTerminalScreenProjection;
}

interface PendingObservationWaiter {
  readonly afterCursor: ProcessOutputCursor;
  readonly resolve: (result: ProcessOutputObservationReadResult) => void;
  readonly timer: NodeJS.Timeout;
}

function validateLimits(
  limits: PtyCommandOutputObservationLimits,
): PtyCommandOutputObservationLimits {
  if (!Number.isSafeInteger(limits.maxSnapshots) || limits.maxSnapshots <= 0) {
    throw new Error('PTY output observation maxSnapshots must be a positive safe integer');
  }
  if (
    !Number.isSafeInteger(limits.maxCharactersPerSnapshot)
    || limits.maxCharactersPerSnapshot <= 0
    || !Number.isSafeInteger(limits.maxLinesPerSnapshot)
    || limits.maxLinesPerSnapshot <= 0
  ) {
    throw new Error('PTY output observation text limits must be positive safe integers');
  }
  return Object.freeze({ ...limits });
}

function validateWaitTimeout(waitTimeoutMs: number): void {
  if (
    !Number.isSafeInteger(waitTimeoutMs)
    || waitTimeoutMs <= 0
    || waitTimeoutMs > MAX_PROCESS_OUTPUT_WAIT_TIMEOUT_MS
  ) {
    throw new Error('process output wait timeout is outside the reliable timer range');
  }
}

/**
 * PTY 屏幕会覆盖旧内容，因此 cursor 记录的是有界屏幕版本，不是可拼接的 stdout delta。
 * 同一 cursor 仍可由多个 Agent 重试；落后时明确 omitted，并只返回最新可用屏幕。
 */
export function createBoundedPtyCommandOutputObservation(
  rawLimits: PtyCommandOutputObservationLimits,
): PtyCommandOutputObservationController {
  const limits = validateLimits(rawLimits);
  const snapshots: RetainedScreenSnapshot[] = [];
  const waiters = new Set<PendingObservationWaiter>();
  let currentCursor = ProcessOutputCursorSchema.parse(0);
  let discardedThroughCursor = ProcessOutputCursorSchema.parse(0);
  let outputPhase: 'open' | 'closed' = 'open';
  let textProjection: 'available' | 'failed' = 'available';

  function nextCursor(): ProcessOutputCursor {
    currentCursor = ProcessOutputCursorSchema.parse(currentCursor + 1);
    return currentCursor;
  }

  function read(afterCursor: ProcessOutputCursor): ProcessOutputObservationReadResult {
    if (afterCursor > currentCursor) return { status: 'invalid_cursor' };
    const coverage = afterCursor < discardedThroughCursor ? 'omitted' as const : 'complete' as const;
    const latest = snapshots.length > 0 ? snapshots[snapshots.length - 1] : undefined;
    const visible = latest && latest.cursor > afterCursor ? latest : undefined;
    return Object.freeze({
      status: 'observed' as const,
      observation: Object.freeze({
        mode: 'pty' as const,
        coverage,
        requestedCursor: afterCursor,
        availableAfterCursor: discardedThroughCursor,
        nextCursor: currentCursor,
        ...(visible ? { terminal: visible.terminal, screen: visible.screen } : {}),
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

  function append(snapshot: {
    readonly stableScreenText: string;
    readonly screen: PtyTerminalScreenProjection;
  }): void {
    const bounded = createBoundedCommandTextProjection({
      maxCharactersPerStream: limits.maxCharactersPerSnapshot,
      maxLinesPerStream: limits.maxLinesPerSnapshot,
    });
    bounded.append(snapshot.stableScreenText);
    snapshots.push(Object.freeze({
      cursor: nextCursor(),
      terminal: bounded.finalize(),
      screen: snapshot.screen,
    }));
    while (snapshots.length > limits.maxSnapshots) {
      const removed = snapshots.shift();
      if (removed) discardedThroughCursor = removed.cursor;
    }
    wakeWaiters();
  }

  const controller: PtyCommandOutputObservationController = {
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
    accept(snapshot) {
      if (outputPhase === 'closed') {
        throw new Error('cannot accept PTY output observation after close');
      }
      append(snapshot);
    },
    markProjectionFailed() {
      if (outputPhase === 'closed' || textProjection === 'failed') return;
      textProjection = 'failed';
      nextCursor();
      wakeWaiters();
    },
    close(finalSnapshot) {
      if (outputPhase === 'closed') return;
      if (finalSnapshot !== undefined) append(finalSnapshot);
      outputPhase = 'closed';
      wakeWaiters();
    },
    get currentCursor() {
      return currentCursor;
    },
  };
  return Object.freeze(controller);
}
