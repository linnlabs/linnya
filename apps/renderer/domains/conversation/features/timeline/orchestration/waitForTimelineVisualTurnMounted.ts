import { watch, type Ref } from 'vue';
import type {
  ConversationCompleteVisualTurnId,
  ConversationVisualTurnId,
} from '@app/schemas';

const DEFAULT_TARGET_READY_TIMEOUT_MS = 2_000;

interface TimelineTurnPositionIdentity {
  readonly visualTurnId: ConversationVisualTurnId;
}

function createTimelineNavigationAbortError(): Error {
  const error = new Error('timeline navigation cancelled');
  error.name = 'AbortError';
  return error;
}

export function isTimelineNavigationAbortError(value: unknown): boolean {
  return value instanceof Error && value.name === 'AbortError';
}

/** 等待目标进入虚拟测量结果；换窗结束本身不能代表目标已经可滚动。 */
export function waitForTimelineVisualTurnMounted(
  positions: Readonly<Ref<readonly TimelineTurnPositionIdentity[]>>,
  visualTurnId: ConversationCompleteVisualTurnId,
  signal: AbortSignal,
  timeoutMs = DEFAULT_TARGET_READY_TIMEOUT_MS,
): Promise<void> {
  if (positions.value.some(position => position.visualTurnId === visualTurnId)) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let stopWatching = (): void => undefined;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      stopWatching();
      if (timeoutId !== null) clearTimeout(timeoutId);
      signal.removeEventListener('abort', handleAbort);
      if (error) reject(error);
      else resolve();
    };
    const handleAbort = (): void => finish(createTimelineNavigationAbortError());

    stopWatching = watch(
      positions,
      nextPositions => {
        if (nextPositions.some(position => position.visualTurnId === visualTurnId)) finish();
      },
      { flush: 'post' },
    );
    timeoutId = setTimeout(() => {
      finish(new Error(`timeline visual turn did not become ready: ${visualTurnId}`));
    }, timeoutMs);
    signal.addEventListener('abort', handleAbort, { once: true });
    if (signal.aborted) handleAbort();
  });
}
