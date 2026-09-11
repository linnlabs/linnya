/** App owner 管理账号目录同步；授权、启动刷新和退出登录共享同一个执行边界。 */
export interface ProviderModelSynchronizationLifecycle {
  start(): void;
  synchronizeConnectedProviderModels(connectionId: string): Promise<void>;
  cancelAndWait(connectionId: string): Promise<void>;
  stop(): Promise<void>;
}

export interface ProviderModelSynchronizationDependencies {
  readonly startupConnectionIds: readonly string[];
  publishModelsChanged(): void;
  synchronize(connectionId: string, signal: AbortSignal): Promise<void>;
}
