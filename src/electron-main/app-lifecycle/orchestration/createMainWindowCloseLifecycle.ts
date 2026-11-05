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
    if (intent === 'ordinary_exit' && !ports.isBackendUnavailable()) {
      let hasExecutingCommands = false;
      try {
        const currentActivity = ports.hasExecutingCommands();
        hasExecutingCommands = typeof currentActivity === 'boolean'
          ? currentActivity
          : await currentActivity;
      } catch (error: unknown) {
        // RPC 超时不等于 Backend 已退出；只有监督器确认退出时才无需询问活动状态。
        if (!ports.isBackendUnavailable()) {
          const decision = await ports.requestPreparationFailureDecision({ stage: 'activity_query', intent, error });
          if (decision === 'return') return 'kept_open';
        }
      }
      if (hasExecutingCommands) {
        const decision = await ports.requestExecutingCommandsDecision(intent);
        if (decision === 'return') return 'kept_open';
      }
    }

    try {
      await ports.prepareRendererForClose();
    } catch (error: unknown) {
      // 已退出的 Backend 也可能让文档保存失败，不能以“无任务”为由静默丢弃未保存修改。
      const decision = await ports.requestPreparationFailureDecision({ stage: 'renderer_save', intent, error });
      if (decision === 'return') return 'kept_open';
    }
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
