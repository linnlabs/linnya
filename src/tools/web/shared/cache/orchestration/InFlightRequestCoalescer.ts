export interface CoalescedResult<T> {
  value: T;
  joinedExistingRequest: boolean;
}

interface InFlightEntry<T> {
  controller: AbortController;
  promise: Promise<T>;
  waiterCount: number;
  settled: boolean;
}

class InFlightAbortError extends Error {
  readonly kind = 'aborted';

  constructor(message: string) {
    super(message);
    this.name = 'AbortError';
  }
}

function createAbortError(signal: AbortSignal): InFlightAbortError {
  const message = signal.reason instanceof Error && signal.reason.message
    ? signal.reason.message
    : 'The user aborted a request.';
  return new InFlightAbortError(message);
}

/**
 * 合并同 key 异步工作，但保留每个调用方独立的取消语义。
 * 只有最后一个等待者取消时才终止底层工作，失败或取消后必须立即允许下一次重试。
 */
export class InFlightRequestCoalescer<T> {
  private readonly entries = new Map<string, InFlightEntry<T>>();

  async run(
    key: string,
    signal: AbortSignal | undefined,
    execute: (sharedSignal: AbortSignal) => Promise<T>,
  ): Promise<CoalescedResult<T>> {
    if (signal?.aborted) throw createAbortError(signal);

    let entry = this.entries.get(key);
    const joinedExistingRequest = entry !== undefined;
    if (!entry) {
      const controller = new AbortController();
      entry = {
        controller,
        promise: Promise.resolve().then(() => execute(controller.signal)),
        waiterCount: 0,
        settled: false,
      };
      this.entries.set(key, entry);
      const createdEntry = entry;
      void createdEntry.promise.finally(() => {
        createdEntry.settled = true;
        if (this.entries.get(key) === createdEntry) this.entries.delete(key);
      }).catch(() => undefined);
    }

    const value = await this.waitForEntry(key, entry, signal);
    return { value, joinedExistingRequest };
  }

  private waitForEntry(
    key: string,
    entry: InFlightEntry<T>,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    entry.waiterCount += 1;
    return new Promise<T>((resolve, reject) => {
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener('abort', onAbort);
        entry.waiterCount -= 1;
      };
      const onAbort = (): void => {
        finish();
        if (entry.waiterCount === 0 && !entry.settled) {
          if (this.entries.get(key) === entry) this.entries.delete(key);
          entry.controller.abort(signal?.reason);
        }
        reject(createAbortError(signal ?? new AbortController().signal));
      };

      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      entry.promise.then(
        (value) => {
          if (finished) return;
          finish();
          resolve(value);
        },
        (error: unknown) => {
          if (finished) return;
          finish();
          reject(error);
        },
      );
    });
  }
}
