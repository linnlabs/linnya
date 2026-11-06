export type MainWindowCloseDecision = 'return' | 'stop_and_close';
export type MainWindowCloseIntent = 'ordinary_exit' | 'install_update';

export type MainWindowCloseOutcome = 'kept_open' | 'ready_to_quit';

export interface MainWindowClosePreparationFailure {
  readonly stage: 'activity_query' | 'renderer_save';
  readonly intent: MainWindowCloseIntent;
  readonly error: unknown;
}

/**
 * 最后窗口关闭属于 App 生命周期，而不是 Commands domain：这里仅查询是否存在真实运行中的命令，
 * 不暴露进程 handle、PID 或 owner 内部状态。
 */
export interface MainWindowCloseLifecyclePorts {
  /** 只消费进程监督器已观察到的退出事实，不能把 RPC 失败猜成进程退出。 */
  readonly isBackendUnavailable: () => boolean;
  readonly hasExecutingCommands: () => boolean | Promise<boolean>;
  readonly requestExecutingCommandsDecision: (
    intent: MainWindowCloseIntent,
  ) => Promise<MainWindowCloseDecision>;
  readonly requestPreparationFailureDecision: (
    failure: MainWindowClosePreparationFailure,
  ) => Promise<'return' | 'close_anyway'>;
  readonly prepareRendererForClose: () => Promise<void>;
}

export interface MainWindowCloseLifecycle {
  requestClose(intent: MainWindowCloseIntent): Promise<MainWindowCloseOutcome>;
}
