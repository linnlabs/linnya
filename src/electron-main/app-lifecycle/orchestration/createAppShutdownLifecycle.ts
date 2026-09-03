import type {
  AppShutdownCompletion,
  AppShutdownIntent,
  AppShutdownLifecycle,
  AppShutdownLifecyclePorts,
  AppShutdownPhase,
  AppShutdownRequestOutcome,
  UserPreparedAppShutdownIntent,
} from '../definitions/appShutdownLifecycle';

interface PendingPreparation {
  readonly intent: UserPreparedAppShutdownIntent;
  readonly settlement: Promise<AppShutdownRequestOutcome>;
}

/**
 * App 退出是一项不可逆提交：确认阶段允许用户返回；一旦提交，窗口放行、资源收口、
 * 普通退出或更新交接必须由同一个 owner 决定，迟到消息不能替换已经冻结的意图。
 */
export function createAppShutdownLifecycle(
  ports: AppShutdownLifecyclePorts,
): AppShutdownLifecycle {
  let phase: AppShutdownPhase = 'running';
  let intent: AppShutdownIntent | undefined;
  let pendingPreparation: PendingPreparation | undefined;
  let shutdownCompletion: Promise<AppShutdownCompletion> | undefined;

  function hasCommittedShutdown(): boolean {
    return phase === 'shutdown_committed' || phase === 'update_handoff' || phase === 'exited';
  }

  function commit(nextIntent: AppShutdownIntent): boolean {
    if (hasCommittedShutdown()) return intent === nextIntent;
    intent = nextIntent;
    phase = 'shutdown_committed';
    // 关窗许可属于退出提交本身，而不是普通 app.quit 的附带动作。更新安装和启动失败
    // 同样会触发 BrowserWindow close；若只在普通退出分支放行，updater 会被窗口层反向拦住。
    ports.commitWindowClosePermission();
    return true;
  }

  function completeShutdown(): Promise<AppShutdownCompletion> {
    if (shutdownCompletion) return shutdownCompletion;
    if (!intent || phase !== 'shutdown_committed') {
      return Promise.reject(new Error('应用退出尚未提交'));
    }

    const committedIntent = intent;
    shutdownCompletion = (async () => {
      let shutdownFailure: unknown;
      try {
        await ports.runShutdownStages();
      } catch (error: unknown) {
        shutdownFailure = error;
      }

      try {
        await ports.drainDiagnosticLog();
      } catch (error: unknown) {
        shutdownFailure ??= error;
      }

      if (committedIntent === 'install_update' && shutdownFailure === undefined) {
        try {
          // quitAndInstall 会同步触发 Electron quit 事件；先切换 phase，让 host 不再拦截 updater handoff。
          phase = 'update_handoff';
          ports.updateHandoff.handoff();
          return Object.freeze({
            intent: committedIntent,
            exitCode: null,
            completed: true,
            updateHandoffStarted: true,
          });
        } catch (error: unknown) {
          phase = 'shutdown_committed';
          shutdownFailure = error;
        }
      }

      const completed = shutdownFailure === undefined;
      const exitCode = committedIntent === 'startup_failure' || !completed ? 1 : 0;
      phase = 'exited';
      ports.exitElectron(exitCode);
      return Object.freeze({
        intent: committedIntent,
        exitCode,
        completed,
        updateHandoffStarted: false,
      });
    })();
    return shutdownCompletion;
  }

  function requestPreparedShutdown(
    nextIntent: UserPreparedAppShutdownIntent,
    onCommitted?: () => void,
  ): Promise<AppShutdownRequestOutcome> {
    if (nextIntent === 'install_update' && !ports.updateHandoff.isReady()) {
      return Promise.resolve('update_not_ready');
    }
    if (hasCommittedShutdown()) {
      return Promise.resolve(intent === nextIntent ? 'shutdown_committed' : 'intent_conflict');
    }
    if (pendingPreparation) {
      return pendingPreparation.intent === nextIntent
        ? pendingPreparation.settlement
        : Promise.resolve('intent_conflict');
    }

    phase = 'preparing_exit';
    const settlement = (async (): Promise<AppShutdownRequestOutcome> => {
      try {
        const preparation = await ports.prepareAppShutdown(nextIntent);
        if (hasCommittedShutdown()) {
          return intent === nextIntent ? 'shutdown_committed' : 'intent_conflict';
        }
        if (preparation === 'kept_open') {
          phase = 'running';
          return 'kept_open';
        }

        commit(nextIntent);
        onCommitted?.();
        if (nextIntent === 'install_update') {
          await completeShutdown();
        } else {
          ports.requestElectronQuit();
        }
        return 'shutdown_committed';
      } catch (error: unknown) {
        if (phase === 'preparing_exit') phase = 'running';
        throw error;
      }
    })().finally(() => {
      if (pendingPreparation?.settlement === settlement) pendingPreparation = undefined;
    });
    pendingPreparation = { intent: nextIntent, settlement };
    return settlement;
  }

  return Object.freeze({
    requestOrdinaryExit: () => requestPreparedShutdown('ordinary_exit'),
    requestInstallUpdate: (onCommitted?: () => void) => (
      requestPreparedShutdown('install_update', onCommitted)
    ),

    requestStartupFailure() {
      if (!commit('startup_failure')) return;
      ports.requestElectronQuit();
    },

    completeCommittedShutdown: completeShutdown,
    getPhase: () => phase,
    getIntent: () => intent,
    isWindowClosePermitted: () => hasCommittedShutdown(),
    isUpdateHandoffInProgress: () => phase === 'update_handoff',
    // 确认和保存期间保留原窗口，但忽略 activate/second-instance，防止建立第二个窗口 owner。
    canAcceptWindowRequest: () => phase === 'running',
  });
}
