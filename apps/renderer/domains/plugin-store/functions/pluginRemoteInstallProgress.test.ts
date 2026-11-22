import { describe, expect, it } from 'vitest';

import {
  applyRemoteInstallProgress,
  createRemoteInstallProgress,
  summarizeRemoteInstallProgress,
} from './pluginRemoteInstallProgress';

const runtime = { kind: 'runtime', id: 'qdrant', version: '1.14.1', totalBytes: 24_000_000 } as const;
const plugin = { kind: 'plugin', id: 'knowledge', version: '0.2.0', totalBytes: 2_000_000 } as const;

describe('远程安装进度投影', () => {
  it('按计划累计：运行时下载中 → 运行时安装 → 插件下载完成，总进度单调到 100%', () => {
    let state = applyRemoteInstallProgress(createRemoteInstallProgress(), { stage: 'planned', downloads: [runtime, plugin] });
    expect(summarizeRemoteInstallProgress(state)).toMatchObject({ totalBytes: 26_000_000, receivedBytes: 0, ratio: 0, current: null });

    state = applyRemoteInstallProgress(state, { stage: 'downloading', item: runtime, receivedBytes: 13_000_000 });
    expect(summarizeRemoteInstallProgress(state)).toMatchObject({ receivedBytes: 13_000_000, ratio: 0.5, current: { item: runtime, stage: 'downloading' } });

    state = applyRemoteInstallProgress(state, { stage: 'installing', item: runtime });
    expect(summarizeRemoteInstallProgress(state).receivedBytes).toBe(24_000_000);

    state = applyRemoteInstallProgress(state, { stage: 'downloading', item: plugin, receivedBytes: 2_000_000 });
    expect(summarizeRemoteInstallProgress(state)).toMatchObject({ receivedBytes: 26_000_000, ratio: 1, current: { item: plugin } });
  });

  it('乱序的旧事件不让进度倒退；超出声明大小的字节不计入', () => {
    let state = applyRemoteInstallProgress(createRemoteInstallProgress(), { stage: 'planned', downloads: [plugin] });
    state = applyRemoteInstallProgress(state, { stage: 'downloading', item: plugin, receivedBytes: 1_500_000 });
    state = applyRemoteInstallProgress(state, { stage: 'downloading', item: plugin, receivedBytes: 500_000 });
    expect(summarizeRemoteInstallProgress(state).receivedBytes).toBe(1_500_000);
    state = applyRemoteInstallProgress(state, { stage: 'downloading', item: plugin, receivedBytes: 9_000_000 });
    expect(summarizeRemoteInstallProgress(state)).toMatchObject({ receivedBytes: 2_000_000, ratio: 1 });
  });

  it('有组件未声明大小时没有百分比；新的计划重置进度', () => {
    const unsized = { ...plugin, totalBytes: null };
    let state = applyRemoteInstallProgress(createRemoteInstallProgress(), { stage: 'planned', downloads: [unsized] });
    state = applyRemoteInstallProgress(state, { stage: 'downloading', item: unsized, receivedBytes: 700 });
    expect(summarizeRemoteInstallProgress(state)).toMatchObject({ totalBytes: null, receivedBytes: 700, ratio: null });

    state = applyRemoteInstallProgress(state, { stage: 'planned', downloads: [plugin] });
    expect(summarizeRemoteInstallProgress(state)).toMatchObject({ totalBytes: 2_000_000, receivedBytes: 0 });
  });

  it('空计划（全部已就绪）不产生百分比，也不报错', () => {
    const state = applyRemoteInstallProgress(createRemoteInstallProgress(), { stage: 'planned', downloads: [] });
    expect(summarizeRemoteInstallProgress(state)).toEqual({ totalBytes: null, receivedBytes: 0, ratio: null, current: null });
  });
});
