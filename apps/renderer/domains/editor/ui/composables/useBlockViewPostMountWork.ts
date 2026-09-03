import type { ComputedRef } from 'vue';

interface EditorPerfBenchmarkControl {
  disableInitialBlockChromeMount?: boolean;
  disableBlockViewPostMountWork?: boolean;
  logBlockViewMountMicrotasks?: boolean;
}

declare global {
  interface Window {
    __EDITOR_PERF_BENCH_CONTROL__?: EditorPerfBenchmarkControl;
    __EDITOR_BLOCK_VIEW_MOUNT_MICROTASK_COUNT__?: number;
  }
}

interface BlockViewPostMountJob {
  blockId: string;
  run: () => void;
  isCancelled: () => boolean;
}

export interface BlockViewPostMountWorkOptions {
  blockId: ComputedRef<string>;
  shouldMountBlockChrome: ComputedRef<boolean>;
  isUnmounted: () => boolean;
  getRootBlockOuterEl: () => HTMLElement | null;
  observeBlock: (el: HTMLElement) => void;
  registerBlockVisibility: (blockId: string, el: HTMLElement) => void;
  requestBlockChromeMount: () => void;
}

const BLOCK_VIEW_POST_MOUNT_BATCH_SIZE = 12;
const BLOCK_VIEW_POST_MOUNT_BATCH_BUDGET_MS = 8;
const blockViewPostMountQueue: BlockViewPostMountJob[] = [];
let blockViewPostMountFlushTimer: number | null = null;

function readBenchmarkControl(): EditorPerfBenchmarkControl {
  if (typeof window === 'undefined') return {};
  return window.__EDITOR_PERF_BENCH_CONTROL__ ?? {};
}

export function logBlockViewMountMicrotask(blockId: string, stage: string): void {
  const control = readBenchmarkControl();
  if (!control.logBlockViewMountMicrotasks || typeof window === 'undefined') return;

  const nextCount = (window.__EDITOR_BLOCK_VIEW_MOUNT_MICROTASK_COUNT__ ?? 0) + 1;
  window.__EDITOR_BLOCK_VIEW_MOUNT_MICROTASK_COUNT__ = nextCount;
  if (nextCount <= 8 || nextCount % 25 === 0) {
    console.info(`[BlockViewMountMicrotask] stage=${stage} count=${nextCount} blockId=${blockId}`);
  }
}

export function checkBlockViewInViewportSync(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  // 中文说明：height 为 0 时 layout 尚不可信，此时不能触发初始 chrome mount。
  if (rect.height === 0) return false;
  const margin = 500;
  return rect.top < window.innerHeight + margin && rect.bottom > -margin;
}

function scheduleBlockViewPostMountFlush(): void {
  if (typeof window === 'undefined' || blockViewPostMountFlushTimer !== null) return;
  blockViewPostMountFlushTimer = window.setTimeout(() => {
    blockViewPostMountFlushTimer = null;
    flushBlockViewPostMountQueue();
  }, 0);
}

function enqueueBlockViewPostMountJob(job: BlockViewPostMountJob): void {
  blockViewPostMountQueue.push(job);
  scheduleBlockViewPostMountFlush();
}

function flushBlockViewPostMountQueue(): void {
  const startedAt = performance.now();
  let processedCount = 0;

  while (blockViewPostMountQueue.length > 0) {
    const job = blockViewPostMountQueue.shift();
    if (!job) break;
    if (!job.isCancelled()) job.run();

    processedCount += 1;
    if (
      processedCount >= BLOCK_VIEW_POST_MOUNT_BATCH_SIZE ||
      performance.now() - startedAt >= BLOCK_VIEW_POST_MOUNT_BATCH_BUDGET_MS
    ) {
      break;
    }
  }

  if (blockViewPostMountQueue.length > 0) {
    scheduleBlockViewPostMountFlush();
  }
}

export function runBlockViewPostMountWork(options: BlockViewPostMountWorkOptions): void {
  logBlockViewMountMicrotask(options.blockId.value, 'postWork:start');
  const el = options.getRootBlockOuterEl();
  if (!el || options.isUnmounted()) {
    logBlockViewMountMicrotask(options.blockId.value, 'postWork:skip-missing-el');
    return;
  }

  // 中文说明：这批 DOM 注册会在大文档首屏产生 100+ 次，不能压进 Vue nextTick 队列；
  // 否则 Vue post-flush 后的微任务会长时间占住事件循环，导致 timer/raf/probe 都无法执行。
  options.observeBlock(el);
  options.registerBlockVisibility(options.blockId.value, el);

  if (checkBlockViewInViewportSync(el)) {
    if (readBenchmarkControl().disableInitialBlockChromeMount) {
      logBlockViewMountMicrotask(options.blockId.value, 'skip-initial-chrome');
      return;
    }
    options.requestBlockChromeMount();
    logBlockViewMountMicrotask(options.blockId.value, 'request-chrome-mount');
    return;
  }

  requestAnimationFrame(() => {
    if (options.isUnmounted()) return;
    if (!options.shouldMountBlockChrome.value && el && checkBlockViewInViewportSync(el)) {
      if (readBenchmarkControl().disableInitialBlockChromeMount) {
        logBlockViewMountMicrotask(options.blockId.value, 'skip-raf-chrome');
        return;
      }
      options.requestBlockChromeMount();
    }
  });
  logBlockViewMountMicrotask(options.blockId.value, 'postWork:end');
}

export function scheduleBlockViewPostMountWork(options: BlockViewPostMountWorkOptions): void {
  if (readBenchmarkControl().disableBlockViewPostMountWork) {
    logBlockViewMountMicrotask(options.blockId.value, 'mounted:skip-post-work');
    return;
  }

  const mountedBlockId = options.blockId.value;
  enqueueBlockViewPostMountJob({
    blockId: mountedBlockId,
    isCancelled: () => options.isUnmounted() || options.blockId.value !== mountedBlockId,
    run: () => runBlockViewPostMountWork(options),
  });
  logBlockViewMountMicrotask(options.blockId.value, 'mounted:queued-post-work');
}

export function clearBlockViewPostMountQueueForTest(): void {
  blockViewPostMountQueue.splice(0);
  if (blockViewPostMountFlushTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(blockViewPostMountFlushTimer);
  }
  blockViewPostMountFlushTimer = null;
}
