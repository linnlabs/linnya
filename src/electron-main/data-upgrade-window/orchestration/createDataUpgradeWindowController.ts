import type { AppServerStartupProgress } from '../../../app-hosts/linnya/app-server-control';
import type {
  DataUpgradeWindowPort,
  DataUpgradeWindowTiming,
} from '../definitions/dataUpgradeWindow';

export const DEFAULT_DATA_UPGRADE_WINDOW_TIMING: DataUpgradeWindowTiming = Object.freeze({
  showDelayMs: 1_000,
  minimumVisibleMs: 800,
});

export interface DataUpgradeWindowController {
  handleProgress(progress: AppServerStartupProgress): void;
  /**
   * App Server ready 后、创建主窗口前调用：取消尚未到时的显示；已经显示时等到最短显示时间。
   */
  settle(): Promise<void>;
  /** 主窗口创建后关闭。必须晚于主窗口创建，否则 Windows 会把“最后一个窗口关闭”当成退出。 */
  close(): void;
  /** 启动失败：隐藏窗口，不再打开。 */
  hide(): void;
}

/**
 * 只有这次启动有数据格式升级、且升级超过 `showDelayMs` 仍未完成时才显示窗口。
 * 一般升级在启动时几百毫秒内完成，用户不会看到它。
 */
export function createDataUpgradeWindowController(input: {
  readonly port: DataUpgradeWindowPort;
  readonly timing?: DataUpgradeWindowTiming;
}): DataUpgradeWindowController {
  const timing = input.timing ?? DEFAULT_DATA_UPGRADE_WINDOW_TIMING;
  let state: 'idle' | 'pending' | 'visible' | 'hidden' | 'closed' = 'idle';
  let fraction = 0;
  let visibleSince = 0;
  let showTimer: NodeJS.Timeout | null = null;

  const cancelPendingShow = (): void => {
    if (showTimer) clearTimeout(showTimer);
    showTimer = null;
    if (state === 'pending') state = 'idle';
  };

  const show = (): void => {
    showTimer = null;
    if (state !== 'pending') return;
    state = 'visible';
    visibleSince = Date.now();
    input.port.open(fraction);
  };

  return Object.freeze({
    handleProgress(progress: AppServerStartupProgress) {
      fraction = progress.state === 'finished' ? 1 : progress.completedSteps / progress.totalSteps;
      if (progress.state === 'started') {
        if (!progress.upgrading || state !== 'idle') return;
        state = 'pending';
        showTimer = setTimeout(show, timing.showDelayMs);
        return;
      }
      // 升级在显示前已经完成：之后的其他启动步骤不是“升级数据”，不再弹出窗口。
      if (progress.state === 'finished' && state === 'pending') cancelPendingShow();
      if (state === 'visible') input.port.setProgress(fraction);
    },
    async settle() {
      cancelPendingShow();
      if (state !== 'visible') return;
      const remaining = visibleSince + timing.minimumVisibleMs - Date.now();
      if (remaining > 0) await new Promise<void>(resolve => setTimeout(resolve, remaining));
    },
    close() {
      cancelPendingShow();
      if (state === 'visible' || state === 'hidden') input.port.close();
      state = 'closed';
    },
    hide() {
      cancelPendingShow();
      if (state !== 'visible') return;
      state = 'hidden';
      input.port.hide();
    },
  });
}
