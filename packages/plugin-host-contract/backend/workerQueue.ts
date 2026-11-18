import type { PluginInferenceOperation, PluginInferencePort } from './inferenceRuntime';

export type PluginWorkerJobState = 'pending' | 'running' | 'completed' | 'failed';

export interface PluginWorkerJob<T extends object> {
  readonly id: string;
  readonly data: T;
  readonly state: PluginWorkerJobState;
  readonly progress: number;
  readonly result?: unknown;
  readonly error?: string;
  readonly createdAt: number;
  readonly startedAt?: number;
  readonly completedAt?: number;
}

export interface PluginWorkerInferenceAdmission {
  readonly operations: readonly PluginInferenceOperation[];
  readonly modelIds: readonly string[];
  readonly inputFiles: readonly string[];
  readonly temporaryDirectory?: string;
}

export interface PluginWorkerQueueOptions<T extends object> {
  readonly pluginId: string;
  /** 只能是已准入插件 artifact 内的相对入口。 */
  readonly workerEntry: string;
  readonly maxConcurrency?: number;
  /** 入队时冻结；未声明则不提供 Host 推理。 */
  readonly inferenceAdmission?: (job: Readonly<T>) => PluginWorkerInferenceAdmission;
}

export interface PluginWorkerQueueObserver {
  progress?(event: {
    readonly jobId: string;
    readonly progress: number;
    readonly data: unknown;
  }): void;
  completed?(event: { readonly jobId: string; readonly result: unknown }): void;
  failed?(event: { readonly jobId: string; readonly error: string }): void;
  /** 线程及其 Host 请求均已停止；completed/cancel 返回不能替代此事实。 */
  settled?(jobId: string): void;
}

export interface PluginWorkerQueue<T extends object> {
  /** job 身份独立于可 structured-clone 的业务 payload；旧 Worker/IPC 字段由插件 owner 保留。 */
  addJob(jobId: string, data: T, execution?: PluginWorkerJobExecution): Promise<string>;
  getJob(jobId: string): PluginWorkerJob<T> | undefined;
  listJobs(): readonly PluginWorkerJob<T>[];
  cancelJob(jobId: string): Promise<boolean>;
  shutdown(): Promise<void>;
  subscribe(observer: PluginWorkerQueueObserver): () => void;
}

/** 只在 Backend 主线程传递，不能写入业务 payload 或 structured-clone 到 Worker。 */
export interface PluginWorkerJobExecution {
  readonly inference: PluginInferencePort;
  readonly signal: AbortSignal;
}

export declare function createPluginWorkerQueue<T extends object>(
  options: PluginWorkerQueueOptions<T>
): PluginWorkerQueue<T>;
