/**
 * @file revisionPendingPerf.ts
 * @description Revision pending 注入性能采样。
 *
 * 中文说明：
 * - 默认只在“大批量或明显耗时”的注入结束时输出一条汇总日志；
 * - 所有采样都会保存到 window.__REVISION_PERF__，便于手动或自动读取；
 * - 不依赖 Vue / Tiptap，避免为了看性能引入额外运行时耦合。
 */

export type RevisionPendingPerfStage =
  | 'shadow'
  | 'canonical'
  | 'parse'
  | 'plan'
  | 'apply'
  | 'flush'
  | 'citation';

export interface RevisionPendingPerfSample {
  id: number;
  startedAt: number;
  pendingCount: number;
  canonicalBlockCount: number;
  activeRevisionCount: number;
  successCount: number;
  failedCount: number;
  forceCitation: boolean;
  totalMs: number;
  stages: Partial<Record<RevisionPendingPerfStage, number>>;
  error?: string;
}

export interface RevisionPendingPerfSession {
  addStage: (stage: RevisionPendingPerfStage, durationMs: number) => void;
  finish: (summary: Omit<RevisionPendingPerfSample, 'id' | 'startedAt' | 'pendingCount' | 'totalMs' | 'stages'>) => RevisionPendingPerfSample;
}

interface RevisionPerfApi {
  getLast: () => RevisionPendingPerfSample | null;
  getHistory: () => RevisionPendingPerfSample[];
  clear: () => void;
  setConsoleEnabled: (enabled: boolean) => void;
  setVerbose: (enabled: boolean) => void;
}

const history: RevisionPendingPerfSample[] = [];
let nextId = 1;
let consoleEnabled = true;
let verbose = false;

const MAX_HISTORY = 20;
const LOG_PENDING_THRESHOLD = 20;
const LOG_DURATION_THRESHOLD_MS = 100;

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

function shouldLog(sample: RevisionPendingPerfSample): boolean {
  return (
    consoleEnabled &&
    (verbose || sample.pendingCount >= LOG_PENDING_THRESHOLD || sample.totalMs >= LOG_DURATION_THRESHOLD_MS || !!sample.error)
  );
}

function recordSample(sample: RevisionPendingPerfSample): void {
  history.push(sample);
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }

  if (shouldLog(sample)) {
    console.info('[RevisionPerf] pending 注入性能', {
      pendingCount: sample.pendingCount,
      canonicalBlockCount: sample.canonicalBlockCount,
      activeRevisionCount: sample.activeRevisionCount,
      successCount: sample.successCount,
      failedCount: sample.failedCount,
      forceCitation: sample.forceCitation,
      totalMs: sample.totalMs,
      stages: sample.stages,
      error: sample.error,
    });
  }
}

export function createRevisionPendingPerfSession(pendingCount: number): RevisionPendingPerfSession {
  const id = nextId++;
  const startedAt = nowMs();
  const stages: Partial<Record<RevisionPendingPerfStage, number>> = {};

  return {
    addStage(stage, durationMs) {
      stages[stage] = roundMs((stages[stage] ?? 0) + Math.max(0, durationMs));
    },
    finish(summary) {
      const sample: RevisionPendingPerfSample = {
        id,
        startedAt,
        pendingCount,
        totalMs: roundMs(nowMs() - startedAt),
        stages,
        ...summary,
      };
      recordSample(sample);
      return sample;
    },
  };
}

export function measureRevisionPendingStage<T>(
  session: RevisionPendingPerfSession,
  stage: RevisionPendingPerfStage,
  fn: () => T
): T {
  const started = nowMs();
  try {
    return fn();
  } finally {
    session.addStage(stage, nowMs() - started);
  }
}

export async function measureRevisionPendingStageAsync<T>(
  session: RevisionPendingPerfSession,
  stage: RevisionPendingPerfStage,
  fn: () => Promise<T>
): Promise<T> {
  const started = nowMs();
  try {
    return await fn();
  } finally {
    session.addStage(stage, nowMs() - started);
  }
}

function installWindowApi(): void {
  if (typeof window === 'undefined') return;
  const root = window as unknown as Record<string, unknown>;
  const api: RevisionPerfApi = {
    getLast: () => history[history.length - 1] ?? null,
    getHistory: () => [...history],
    clear: () => {
      history.length = 0;
    },
    setConsoleEnabled: (enabled) => {
      consoleEnabled = enabled;
    },
    setVerbose: (enabled) => {
      verbose = enabled;
    },
  };
  root.__REVISION_PERF__ = api;
}

installWindowApi();
