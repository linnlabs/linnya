/** 受管线程只接收可 structured-clone 的业务数据。 */
export interface PluginWorkerTask {
  readonly taskId: string;
}

export type PluginWorkerJobState = 'pending' | 'running' | 'completed' | 'failed';

export interface PluginWorkerJob<T extends PluginWorkerTask> {
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
  readonly operations: readonly ('embed' | 'text' | 'ocr-profile' | 'ocr')[];
  readonly modelIds: readonly string[];
  readonly inputFiles: readonly string[];
  readonly temporaryDirectory?: string;
}

export interface PluginWorkerQueueOptions<T extends PluginWorkerTask> {
  readonly pluginId: string;
  /** 只能是已准入插件 artifact 内的相对入口。 */
  readonly workerEntry: string;
  readonly maxConcurrency?: number;
  /** 入队时冻结；未声明则不提供 Host 推理。 */
  readonly inferenceAdmission?: (job: Readonly<T>) => PluginWorkerInferenceAdmission;
}

export interface PluginWorkerQueueObserver {
  progress?(event: {
    readonly taskId: string;
    readonly progress: number;
    readonly data: unknown;
  }): void;
  completed?(event: { readonly taskId: string; readonly result: unknown }): void;
  failed?(event: { readonly taskId: string; readonly error: string }): void;
  /** 线程及其 Host 请求均已停止；completed/cancel 返回不能替代此事实。 */
  settled?(taskId: string): void;
}

export interface PluginWorkerQueue<T extends PluginWorkerTask> {
  addTask(task: T): Promise<string>;
  getTask(taskId: string): PluginWorkerJob<T> | undefined;
  listTasks(): readonly PluginWorkerJob<T>[];
  cancelTask(taskId: string): Promise<boolean>;
  shutdown(): Promise<void>;
  subscribe(observer: PluginWorkerQueueObserver): () => void;
}

export declare function createPluginWorkerQueue<T extends PluginWorkerTask>(
  options: PluginWorkerQueueOptions<T>
): PluginWorkerQueue<T>;
