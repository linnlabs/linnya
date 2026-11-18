/** 与 Main 更新合同 AppUpdateStatus 同名；idle 即“没有更新”，入口不出现。 */
export const UPDATE_FIXTURE_STATUSES = ['idle', 'available', 'downloading', 'paused', 'failed', 'ready', 'installing'];

const MiB = 1024 * 1024;

/**
 * 按 createAppUpdateController 的快照形状造一份完整状态。只喂给 Renderer 镜像：
 * 探针实例关闭了更新检查，Main 不会再推送覆盖它；页面 reload 后回到 Main 的真实状态。
 */
export function updateFixtureSnapshot(status, { currentVersion, now = Date.now() }) {
  if (!UPDATE_FIXTURE_STATUSES.includes(status)) {
    throw new Error(`未知更新状态 ${status}，可选 ${UPDATE_FIXTURE_STATUSES.join(' / ')}`);
  }
  const transferring = status === 'downloading' || status === 'paused';
  return {
    enabled: true,
    status,
    currentVersion,
    version: status === 'idle' ? null : '99.0.0',
    releaseNotes: null,
    progress: transferring
      ? { fraction: 0.42, transferredBytes: 42 * MiB, totalBytes: 100 * MiB, bytesPerSecond: status === 'downloading' ? 3 * MiB : null }
      : null,
    failure: status === 'paused'
      ? { kind: 'network', retryAt: new Date(now + 60_000).toISOString() }
      : status === 'failed' ? { kind: 'network', retryAt: null } : null,
    installedVersion: null,
  };
}
