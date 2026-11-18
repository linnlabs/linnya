import type { PluginWorkerJobExecution } from '@plugin/backend/workerQueue';

/** 一次 CLI 写操作及其派生工作。只在主线程传递，不进 SQLite 或 Worker payload。 */
export interface KnowledgeExecution extends PluginWorkerJobExecution {
  track<T>(operation: Promise<T>): Promise<T>;
  wait(): Promise<void>;
  close(): Promise<void>;
}
