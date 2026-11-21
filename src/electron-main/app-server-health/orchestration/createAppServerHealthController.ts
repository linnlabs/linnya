import type {
  AppServerHealthState,
  AppServerHealthStatus,
} from '../../../shared/app-server-health/definitions/appServerHealthMessage';
import { recordAppServerCrash } from '../functions/recordAppServerCrash';

export const APP_SERVER_PING_INTERVAL_MS = 5_000;
/** 连续这么久没有回应才提示；短暂繁忙不打扰用户。 */
export const APP_SERVER_UNRESPONSIVE_AFTER_MS = 15_000;
/** 先让窗口显示“正在重新启动”，再关闭重开。 */
export const APP_SERVER_RELAUNCH_DELAY_MS = 1_500;
export const APP_SERVER_RECOVERED_NOTICE_MS = 8_000;

export interface AppServerHealthTimers {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface AppServerHealthControllerPorts {
  /** App Server 控制通道 ping；进程卡住时超时失败。 */
  ping(): Promise<void>;
  isAppServerAlive(): boolean;
  /** 强制结束卡住的 App Server；随后进程退出走 handleExit。 */
  killAppServer(): void;
  /** 关闭并重新打开整个应用：启动恢复会把遗留运行标成中断。 */
  relaunchApp(): void;
  crashHistory: {
    read(): readonly number[];
    write(history: readonly number[]): void;
  };
  /** 跨一次重启保留的“刚刚恢复”标记。 */
  recoveredNotice: {
    take(): boolean;
    set(): void;
  };
  publish(state: AppServerHealthState): void;
  timers: AppServerHealthTimers;
  log(message: string, details?: Record<string, unknown>): void;
}

export interface AppServerHealthController {
  getState(): AppServerHealthState;
  /** App Server ready 后调用：开始探测，并处理上一次留下的恢复提示。 */
  start(): void;
  /** App Server 进程退出；expected 表示由宿主正常关闭发起。 */
  handleExit(exit: { readonly expected: boolean }): void;
  /** 用户点“重新启动”。 */
  restart(): void;
  dispose(): void;
}

export function createAppServerHealthController(
  ports: AppServerHealthControllerPorts,
): AppServerHealthController {
  const { timers } = ports;
  let status: AppServerHealthStatus = 'ok';
  let started = false;
  let disposed = false;
  let pingTimer: unknown;
  let noticeTimer: unknown;
  let relaunchTimer: unknown;
  let pingInFlight = false;
  let lastResponsiveAt = timers.now();
  let restartRequested = false;

  const setStatus = (next: AppServerHealthStatus): void => {
    if (status === next) return;
    status = next;
    ports.log('后台服务状态变化', { status });
    ports.publish({ status });
  };

  const stopProbing = (): void => {
    if (pingTimer !== undefined) timers.clearTimeout(pingTimer);
    pingTimer = undefined;
    if (noticeTimer !== undefined) timers.clearTimeout(noticeTimer);
    noticeTimer = undefined;
  };

  const scheduleRelaunch = (delayMs: number): void => {
    if (relaunchTimer !== undefined) return;
    relaunchTimer = timers.setTimeout(() => {
      relaunchTimer = undefined;
      if (!disposed) ports.relaunchApp();
    }, delayMs);
  };

  const probe = (): void => {
    pingTimer = timers.setTimeout(() => {
      pingTimer = undefined;
      if (disposed || (status !== 'ok' && status !== 'unresponsive' && status !== 'recovered')) return;
      if (!pingInFlight) {
        pingInFlight = true;
        // 不依赖 ping 自带超时：一次不回的 ping 不能卡住后续探测。
        let timeoutHandle: unknown;
        const timeout = new Promise<never>((_, reject) => {
          timeoutHandle = timers.setTimeout(() => reject(new Error('ping timeout')), APP_SERVER_PING_INTERVAL_MS);
        });
        Promise.race([ports.ping(), timeout]).then(
          () => {
            lastResponsiveAt = timers.now();
            if (status === 'unresponsive') setStatus('ok');
          },
          () => undefined,
        ).finally(() => {
          timers.clearTimeout(timeoutHandle);
          pingInFlight = false;
        });
      }
      if (status === 'ok' && timers.now() - lastResponsiveAt >= APP_SERVER_UNRESPONSIVE_AFTER_MS) {
        setStatus('unresponsive');
      }
      probe();
    }, APP_SERVER_PING_INTERVAL_MS);
  };

  return {
    getState: () => ({ status }),

    start() {
      if (started || disposed) return;
      started = true;
      lastResponsiveAt = timers.now();
      if (ports.recoveredNotice.take()) {
        setStatus('recovered');
        noticeTimer = timers.setTimeout(() => {
          noticeTimer = undefined;
          if (status === 'recovered') setStatus('ok');
        }, APP_SERVER_RECOVERED_NOTICE_MS);
      }
      probe();
    },

    handleExit(exit) {
      stopProbing();
      // 启动期间退出由启动失败对话框负责，不自动重启。
      if (disposed || exit.expected || !started) return;
      if (restartRequested) {
        scheduleRelaunch(0);
        return;
      }
      const decision = recordAppServerCrash(ports.crashHistory.read(), timers.now());
      ports.crashHistory.write(decision.history);
      ports.log('后台服务意外停止', { action: decision.action, crashesInWindow: decision.history.length });
      if (decision.action === 'stop') {
        setStatus('stopped');
        return;
      }
      ports.recoveredNotice.set();
      setStatus('restarting');
      scheduleRelaunch(APP_SERVER_RELAUNCH_DELAY_MS);
    },

    restart() {
      if (disposed || restartRequested) return;
      restartRequested = true;
      stopProbing();
      // 用户明确要求重启，之前的意外停止不再计入自动重启的限额。
      ports.crashHistory.write([]);
      ports.recoveredNotice.set();
      setStatus('restarting');
      if (ports.isAppServerAlive()) ports.killAppServer();
      else scheduleRelaunch(0);
    },

    dispose() {
      disposed = true;
      stopProbing();
      if (relaunchTimer !== undefined) timers.clearTimeout(relaunchTimer);
      relaunchTimer = undefined;
    },
  };
}
