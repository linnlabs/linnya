import type { PluginInstallDownloadItem, PluginInstallProgress } from '@app/schemas';

/**
 * 一次远程安装在界面上的进度投影。Host 先发 planned（本次真正要下载的组件），再按组件报告下载字节与安装阶段；
 * 这里只累计这些事实，不推测下载速度或剩余时间。
 */
export interface RemoteInstallProgressState {
  readonly downloads: readonly PluginInstallDownloadItem[];
  readonly receivedByItem: Readonly<Record<string, number>>;
  readonly current: { readonly item: PluginInstallDownloadItem; readonly stage: 'downloading' | 'installing' } | null;
}

export interface RemoteInstallProgressSummary {
  /** 有组件没有声明大小（开发用 latest.json 来源）时为 null，界面只显示阶段不显示百分比。 */
  readonly totalBytes: number | null;
  readonly receivedBytes: number;
  readonly ratio: number | null;
  readonly current: RemoteInstallProgressState['current'];
}

export function downloadItemKey(item: Pick<PluginInstallDownloadItem, 'kind' | 'id' | 'version'>): string {
  return `${item.kind}:${item.id}@${item.version}`;
}

export function createRemoteInstallProgress(): RemoteInstallProgressState {
  return { downloads: [], receivedByItem: {}, current: null };
}

export function applyRemoteInstallProgress(
  state: RemoteInstallProgressState,
  progress: PluginInstallProgress,
): RemoteInstallProgressState {
  if (progress.stage === 'planned') {
    return { downloads: progress.downloads, receivedByItem: {}, current: null };
  }
  const key = downloadItemKey(progress.item);
  const previous = state.receivedByItem[key] ?? 0;
  // 计划外的组件（理论上不会出现）也纳入，保证总进度不丢字节。
  const downloads = state.downloads.some(item => downloadItemKey(item) === key)
    ? state.downloads
    : [...state.downloads, progress.item];
  if (progress.stage === 'downloading') {
    return {
      downloads,
      // 事件按序到达，但仍取较大值：重复或乱序的旧事件不能让进度倒退。
      receivedByItem: { ...state.receivedByItem, [key]: Math.max(previous, progress.receivedBytes) },
      current: { item: progress.item, stage: 'downloading' },
    };
  }
  return {
    downloads,
    receivedByItem: { ...state.receivedByItem, [key]: progress.item.totalBytes ?? previous },
    current: { item: progress.item, stage: 'installing' },
  };
}

export function summarizeRemoteInstallProgress(state: RemoteInstallProgressState): RemoteInstallProgressSummary {
  const sizes = state.downloads.map(item => item.totalBytes);
  const totalBytes = sizes.length > 0 && sizes.every((size): size is number => size !== null)
    ? sizes.reduce((sum, size) => sum + size, 0)
    : null;
  const receivedBytes = state.downloads.reduce((sum, item) => {
    const received = state.receivedByItem[downloadItemKey(item)] ?? 0;
    return sum + (item.totalBytes === null ? received : Math.min(received, item.totalBytes));
  }, 0);
  return {
    totalBytes,
    receivedBytes,
    ratio: totalBytes && totalBytes > 0 ? Math.min(1, receivedBytes / totalBytes) : null,
    current: state.current,
  };
}
