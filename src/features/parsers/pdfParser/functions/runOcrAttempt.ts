import { OcrTimeoutError } from '../definitions/ocrErrors';

/** 单次 OCR 的超时与任务取消不同：超时按原策略重试，任务取消直接向调用方传播。 */
export async function withAttemptTimeout<T>(args: {
  timeoutMs: number;
  timeoutMessage: string;
  enableAbortSignal: boolean;
  signal?: AbortSignal;
  work: (signal?: AbortSignal) => Promise<T>;
}): Promise<T> {
  const { timeoutMs, timeoutMessage, enableAbortSignal, signal, work } = args;
  signal?.throwIfAborted();
  const controller = enableAbortSignal ? new AbortController() : null;
  const forwarded = signal && controller ? AbortSignal.any([signal, controller.signal]) : signal ?? controller?.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller?.abort(new OcrTimeoutError(timeoutMessage, { timeoutMs }));
      reject(new OcrTimeoutError(timeoutMessage, { timeoutMs }));
    }, timeoutMs);
  });
  const cancelled = new Promise<never>((_resolve, reject) => {
    if (!signal) return;
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const result = await Promise.race([work(forwarded), timeout, cancelled]);
    signal?.throwIfAborted();
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}
