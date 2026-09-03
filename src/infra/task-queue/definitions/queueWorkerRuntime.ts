/**
 * Queue owner 启动时冻结的 Worker bundle 路径。
 *
 * 路径由 App composition 一次解析；队列与 WorkerThreadQueue 不读取 Electron、cwd
 * 或环境变量来猜测运行位置。
 */
export interface QueueWorkerRuntime {
  readonly ingestionScriptPath: string;
  readonly audioProcessingScriptPath: string;
  readonly graphExtractionScriptPath: string;
  readonly graphIndexingScriptPath: string;
}
