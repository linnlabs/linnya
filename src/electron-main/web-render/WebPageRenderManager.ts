import {
  WebPageRenderError,
  type WebPageRenderParams,
  type WebPageRenderResult,
  type WebPageRenderer,
} from '../../tools/web/webread/definitions/webPageRenderer';
import { WebPageRenderWorker } from './WebPageRenderWorker';

const DEFAULT_MAX_CONCURRENCY = 1;
const DEFAULT_IDLE_TIMEOUT_MS = 2 * 60 * 1000;

interface WebPageRenderWorkerLike {
  render(params: WebPageRenderParams): Promise<WebPageRenderResult>;
  dispose(): Promise<void>;
}

interface WorkerSlot {
  readonly worker: WebPageRenderWorkerLike;
  busy: boolean;
  idleSince: number;
}

interface PendingAcquire {
  readonly signal?: AbortSignal;
  readonly resolve: (slot: WorkerSlot) => void;
  readonly reject: (error: WebPageRenderError) => void;
  readonly abort: () => void;
}

export interface WebPageRenderManagerOptions {
  readonly maxConcurrency?: number;
  readonly idleTimeoutMs?: number;
  readonly createWorker?: () => WebPageRenderWorkerLike;
}

export class WebPageRenderManager implements WebPageRenderer {
  private static singleton: WebPageRenderManager | null = null;

  private readonly maxConcurrency: number;
  private readonly idleTimeoutMs: number;
  private readonly createWorker: () => WebPageRenderWorkerLike;
  private readonly slots: WorkerSlot[] = [];
  private readonly waiters: PendingAcquire[] = [];
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(options: WebPageRenderManagerOptions = {}) {
    this.maxConcurrency = Math.min(2, Math.max(1, options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY));
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.createWorker = options.createWorker ?? (() => new WebPageRenderWorker());
  }

  static instance(): WebPageRenderManager {
    if (!WebPageRenderManager.singleton) {
      WebPageRenderManager.singleton = new WebPageRenderManager();
    }
    return WebPageRenderManager.singleton;
  }

  async render(params: WebPageRenderParams): Promise<WebPageRenderResult> {
    const slot = await this.acquire(params.signal);
    try {
      return await slot.worker.render(params);
    } finally {
      this.release(slot);
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.clearIdleTimer();
    const error = new WebPageRenderError('unavailable', '本地网页渲染 manager 正在退出。');
    for (const waiter of this.waiters.splice(0)) {
      waiter.signal?.removeEventListener('abort', waiter.abort);
      waiter.reject(error);
    }
    await Promise.all(this.slots.splice(0).map((slot) => slot.worker.dispose()));
    if (WebPageRenderManager.singleton === this) WebPageRenderManager.singleton = null;
  }

  private acquire(signal?: AbortSignal): Promise<WorkerSlot> {
    if (this.disposed) {
      return Promise.reject(new WebPageRenderError('unavailable', '本地网页渲染 manager 已退出。'));
    }
    if (signal?.aborted) {
      return Promise.reject(new WebPageRenderError('aborted', '网页渲染已由调用方取消。'));
    }
    this.clearIdleTimer();
    const idle = this.slots.find((slot) => !slot.busy);
    if (idle) {
      idle.busy = true;
      return Promise.resolve(idle);
    }
    if (this.slots.length < this.maxConcurrency) {
      const slot: WorkerSlot = { worker: this.createWorker(), busy: true, idleSince: 0 };
      this.slots.push(slot);
      return Promise.resolve(slot);
    }
    return new Promise<WorkerSlot>((resolve, reject) => {
      const pending: PendingAcquire = {
        signal,
        resolve,
        reject,
        abort: () => {
          const index = this.waiters.indexOf(pending);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new WebPageRenderError('aborted', '网页渲染已由调用方取消。'));
        },
      };
      signal?.addEventListener('abort', pending.abort, { once: true });
      this.waiters.push(pending);
    });
  }

  private release(slot: WorkerSlot): void {
    if (this.disposed || !this.slots.includes(slot)) {
      slot.busy = false;
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.signal?.removeEventListener('abort', waiter.abort);
      waiter.resolve(slot);
      return;
    }
    slot.busy = false;
    slot.idleSince = Date.now();
    this.scheduleIdleDispose();
  }

  private scheduleIdleDispose(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      const cutoff = Date.now() - this.idleTimeoutMs;
      const expired = this.slots.filter((slot) => !slot.busy && slot.idleSince <= cutoff);
      for (const slot of expired) {
        const index = this.slots.indexOf(slot);
        if (index >= 0) this.slots.splice(index, 1);
        void slot.worker.dispose();
      }
      if (this.slots.some((slot) => !slot.busy)) this.scheduleIdleDispose();
    }, this.idleTimeoutMs);
  }

  private clearIdleTimer(): void {
    if (!this.idleTimer) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}
