/**
 * “正在升级数据”窗口的 Electron 出口。进度是 0–1 的已完成比例。
 * 控制器决定何时打开、何时关闭；端口只负责窗口本身。
 */
export interface DataUpgradeWindowPort {
  open(fraction: number): void;
  setProgress(fraction: number): void;
  /** 只隐藏不关闭：启动失败时让错误对话框单独出现，窗口随 App 退出收口。 */
  hide(): void;
  close(): void;
}

export interface DataUpgradeWindowTiming {
  /** 升级开始后多久仍未完成才显示窗口；在此之前完成的升级不显示，避免一闪而过。 */
  readonly showDelayMs: number;
  /** 窗口一旦显示，至少保留多久再关闭。 */
  readonly minimumVisibleMs: number;
}

export interface DataUpgradeWindowCopy {
  readonly language: string;
  readonly title: string;
  readonly detail: string;
}
