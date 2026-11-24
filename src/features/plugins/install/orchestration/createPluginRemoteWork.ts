import { PluginOperationError } from '../definitions/pluginOperationError';

/**
 * 插件服务的在途网络工作（catalog 请求、安装下载）。App 退出时由 Backend 停止：
 * 未完成的请求与下载立即取消，已经开始落盘的安装等它结束，之后不再接受新的工作。
 */
export interface PluginRemoteWork {
  /** stop() 之后为 true；安装完成后据此跳过运行态同步，留给下次启动加载。 */
  readonly stopped: boolean;
  run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T>;
  stop(): Promise<void>;
}

export function createPluginRemoteWork(): PluginRemoteWork {
  const controller = new AbortController();
  const active = new Set<Promise<unknown>>();
  return {
    get stopped() {
      return controller.signal.aborted;
    },
    async run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
      controller.signal.throwIfAborted();
      const settlement = work(controller.signal);
      active.add(settlement);
      try {
        return await settlement;
      } finally {
        active.delete(settlement);
      }
    },
    async stop() {
      controller.abort(new PluginOperationError('cancelled', '应用正在退出，已取消插件下载'));
      await Promise.allSettled(active);
    },
  };
}
