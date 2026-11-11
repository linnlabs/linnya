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
  finish: (
    summary: Omit<
      RevisionPendingPerfSample,
      'id' | 'startedAt' | 'pendingCount' | 'totalMs' | 'stages'
    >
  ) => RevisionPendingPerfSample;
}

export interface RevisionPendingPerfApi {
  getLast: () => RevisionPendingPerfSample | null;
  getHistory: () => RevisionPendingPerfSample[];
  clear: () => void;
  setConsoleEnabled: (enabled: boolean) => void;
  setVerbose: (enabled: boolean) => void;
}

declare global {
  interface Window {
    __REVISION_PERF__?: RevisionPendingPerfApi;
  }
}
