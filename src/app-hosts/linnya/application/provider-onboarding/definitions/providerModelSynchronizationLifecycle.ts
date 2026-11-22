/**
 * App owner 管理账号目录同步；授权、启动刷新和退出登录共享同一个执行边界。
 * 它也是目录失效通知的唯一出口：账号同步收口与用户目录事务提交都经由 publishModelsChanged 推送。
 */
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
  /** 用户目录事务提交信号（设置页、CLI、外部 HTTP 等任意入口）；start 订阅，stop 退订。 */
  subscribeToUserCatalogChanges?(listener: () => void): () => void;
}
