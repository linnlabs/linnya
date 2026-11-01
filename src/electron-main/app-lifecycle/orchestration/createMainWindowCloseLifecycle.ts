import type {
  MainWindowCloseLifecycle,
  MainWindowCloseIntent,
  MainWindowCloseLifecyclePorts,
  MainWindowCloseOutcome,
} from '../definitions/mainWindowCloseLifecycle';

/**
 * 用户确认和命令收口刻意分层：本编排只决定是否退出并等待 renderer 保存；真正的命令树停止
 * 继续由 Electron `will-quit` 的唯一后端收口链负责，避免窗口和 App 各维护一套 shutdown。
 */
export function createMainWindowCloseLifecycle(
  ports: MainWindowCloseLifecyclePorts,
): MainWindowCloseLifecycle {
  let currentRequest: Promise<MainWindowCloseOutcome> | undefined;

  async function closeOnce(intent: MainWindowCloseIntent): Promise<MainWindowCloseOutcome> {
    // 安装更新前，更新入口已经列出全部运行中任务并取得确认（含确认后新出现的任务）；
    // 这里再问一次只会让用户对同一件事回答两遍。
    if (intent === 'install_update') {
      await ports.prepareRendererForClose();
      return 'ready_to_quit';
    }
    const currentActivity = ports.hasExecutingCommands();
    const hasExecutingCommands = typeof currentActivity === 'boolean'
      ? currentActivity
      : await currentActivity;
    if (hasExecutingCommands) {
      const decision = await ports.requestExecutingCommandsDecision(intent);
      if (decision === 'return') return 'kept_open';
    }

    await ports.prepareRendererForClose();
    return 'ready_to_quit';
  }

  return Object.freeze({
    requestClose(intent: MainWindowCloseIntent) {
      if (currentRequest) return currentRequest;

      const request = closeOnce(intent).finally(() => {
        if (currentRequest === request) currentRequest = undefined;
      });
      currentRequest = request;
      return request;
    },
  });
}
