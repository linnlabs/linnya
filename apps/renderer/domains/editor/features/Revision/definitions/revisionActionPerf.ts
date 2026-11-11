/**
 * revisionActionPerf.ts
 *
 * 修订接受/拒绝操作的低噪声性能采样。
 *
 * 中文说明：
 * - 这里只记录动作级汇总，不在滚动或投影热路径刷屏；
 * - 万行 pending 下，点击“接受 / 拒绝 / 全部接受 / 全部拒绝”卡顿时，
 *   可以通过 window.__REVISION_ACTION_PERF__ 判断瓶颈在投影、PM 命令、保存、IPC 还是重载文档。
 */

export type RevisionActionKind =
  | 'block-accept'
  | 'block-reject'
  | 'document-accept-all'
  | 'document-reject-all';

export type RevisionActionPath =
  | 'projected-command'
  | 'canonical-clear-only'
  | 'canonical-delete-root'
  | 'backend-apply-all'
  | 'backend-applied-renderer-failed'
  | 'backend-blocked'
  | 'failed'
  | 'noop';

export type RevisionActionStage =
  | 'resolve'
  | 'locate'
  | 'command'
  | 'state'
  | 'save'
  | 'backend'
  | 'backendIpc'
  | 'replaceDocument'
  | 'clearRuntime'
  | 'setDirty';

export interface RevisionActionPerfSample {
  id: number;
  kind: RevisionActionKind;
  path: RevisionActionPath;
  blockId?: string;
  documentId?: string;
  pendingCountBefore?: number;
  activeCountBefore?: number;
  totalMs: number;
  stages: Partial<Record<RevisionActionStage, number>>;
  result: 'success' | 'skipped' | 'failed';
  error?: string;
  timestamp: number;
}

export interface RevisionActionPerfSession {
  measure: <T>(stage: RevisionActionStage, run: () => T) => T;
  measureAsync: <T>(stage: RevisionActionStage, run: () => Promise<T>) => Promise<T>;
  finish: (summary: {
    path: RevisionActionPath;
    result: RevisionActionPerfSample['result'];
    error?: unknown;
  }) => RevisionActionPerfSample;
}

export interface RevisionActionPerfApi {
  getLast: () => RevisionActionPerfSample | null;
  getHistory: () => RevisionActionPerfSample[];
  clear: () => void;
  setConsoleEnabled: (enabled: boolean) => void;
  setVerbose: (enabled: boolean) => void;
}

declare global {
  interface Window {
    __REVISION_ACTION_PERF__?: RevisionActionPerfApi;
  }
}
