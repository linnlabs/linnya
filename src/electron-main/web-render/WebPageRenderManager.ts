import {
  WebPageRenderError,
  type WebPageRenderParams,
  type WebPageRenderResult,
  type WebPageRenderer,
} from '../../tools/web/webread/definitions/webPageRenderer';
import type { WebPageRenderRuntime } from './definitions/webPageRenderRuntime';
import { electronWebPageRenderRuntime } from './electronWebPageRenderRuntime';
import { createSlotRenderSession, type SlotRenderSession } from './functions/createSlotRenderSession';
import { WebPageRenderWorker } from './WebPageRenderWorker';

const DEFAULT_MAX_CONCURRENCY = 1;
const DEFAULT_IDLE_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_PARTITION_PREFIX = 'web-render';

interface WebPageRenderWorkerLike {
  render(params: WebPageRenderParams): Promise<WebPageRenderResult>;
  dispose(): Promise<void>;
}

interface WorkerSlot {
  readonly slotIndex: number;
  readonly partition: string;
  worker: WebPageRenderWorkerLike | null;
  slotSession: SlotRenderSession | null;
  pendingDispose: Promise<void> | null;
  busy: boolean;
  idleSince: number;
}

interface PendingAcquire {
  readonly signal?: AbortSignal;
  readonly resolve: (slot: WorkerSlot) => void;
  readonly reject: (error: WebPageRenderError) => void;
  readonly abort: () => void;
}

export interface WebPageRenderManagerWorkerContext {
  readonly slotIndex: number;
  readonly partition: string;
}

export interface WebPageRenderManagerOptions {
  readonly maxConcurrency?: number;
  readonly idleTimeoutMs?: number;
  readonly runtime?: WebPageRenderRuntime;
  readonly partitionPrefix?: string;
  readonly createWorker?: (context: WebPageRenderManagerWorkerContext) => WebPageRenderWorkerLike;
}

export class WebPageRenderManager implements WebPageRenderer {
  private static singleton: WebPageRenderManager | null = null;

  private readonly maxConcurrency: number;
  private readonly idleTimeoutMs: number;
  private readonly runtime: WebPageRenderRuntime;
  private readonly createWorkerFactory:
    | ((context: WebPageRenderManagerWorkerContext) => WebPageRenderWorkerLike)
    | undefined;
  private readonly slots: WorkerSlot[];
  private readonly waiters: PendingAcquire[] = [];
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(options: WebPageRenderManagerOptions = {}) {
    this.maxConcurrency = Math.min(2, Math.max(1, options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY));
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.runtime = options.runtime ?? electronWebPageRenderRuntime;
    this.createWorkerFactory = options.createWorker;
    const partitionPrefix = options.partitionPrefix ?? DEFAULT_PARTITION_PREFIX;
    this.slots = Array.from({ length: this.maxConcurrency }, (_, slotIndex) => ({
      slotIndex,
      partition: `${partitionPrefix}:slot-${slotIndex}`,
      worker: null,
      slotSession: null,
      pendingDispose: null,
      busy: false,
      idleSince: 0,
    }));
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
      if (this.disposed) throw new WebPageRenderError('unavailable', '本地网页渲染 manager 已退出。');
      // 获取槽位后才创建 worker，创建失败也通过 finally 归还槽位并唤醒队首。
      slot.worker ??= this.spawnWorker(slot);
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
    const pendingWorkers = this.slots.map((slot) => {
      const worker = slot.worker;
      slot.worker = null;
      slot.busy = false;
      return Promise.all([
        slot.pendingDispose ?? Promise.resolve(),
        worker ? worker.dispose() : Promise.resolve(),
      ]);
    });
    await Promise.all(pendingWorkers);
    for (const slot of this.slots) {
      slot.slotSession?.dispose();
      slot.slotSession = null;
    }
    if (WebPageRenderManager.singleton === this) WebPageRenderManager.singleton = null;
  }

  private spawnWorker(slot: WorkerSlot): WebPageRenderWorkerLike {
    if (this.createWorkerFactory) {
      return this.createWorkerFactory({
        slotIndex: slot.slotIndex,
        partition: slot.partition,
      });
    }
    if (!slot.slotSession) {
      slot.slotSession = createSlotRenderSession(this.runtime, slot.partition);
    }
    return new WebPageRenderWorker({
      runtime: this.runtime,
      partition: slot.partition,
      session: slot.slotSession.borrow(),
    });
  }

  private acquire(signal?: AbortSignal): Promise<WorkerSlot> {
    if (this.disposed) {
      return Promise.reject(new WebPageRenderError('unavailable', '本地网页渲染 manager 已退出。'));
    }
    if (signal?.aborted) {
      return Promise.reject(new WebPageRenderError('aborted', '网页渲染已由调用方取消。'));
    }
    const available = this.slots.find(slot => !slot.busy && slot.worker !== null)
      ?? this.slots.find(slot => !slot.busy && !slot.pendingDispose);
    if (available) {
      available.busy = true;
      this.scheduleIdleDispose();
      return Promise.resolve(available);
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
    if (this.disposed) {
      slot.busy = false;
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      slot.busy = true;
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
    const idleSlots = this.slots.filter((slot) => !slot.busy && slot.worker !== null);
    if (idleSlots.length === 0) return;
    const earliestIdleSince = Math.min(...idleSlots.map((slot) => slot.idleSince));
    const delayMs = Math.max(0, earliestIdleSince + this.idleTimeoutMs - Date.now());
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      const cutoff = Date.now() - this.idleTimeoutMs;
      const expired = this.slots.filter((slot) => !slot.busy && slot.worker !== null && slot.idleSince <= cutoff);
      for (const slot of expired) {
        const worker = slot.worker;
        slot.worker = null;
        if (!worker) continue;
        const cleanup = worker.dispose().catch(() => undefined).finally(() => {
          // 回收中的请求都在同一 FIFO 中等待；清理完成本身就应唤醒队首。
          slot.pendingDispose = null;
          this.release(slot);
        });
        slot.pendingDispose = cleanup;
      }
      this.scheduleIdleDispose();
    }, delayMs);
  }

  private clearIdleTimer(): void {
    if (!this.idleTimer) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}
