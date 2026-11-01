import { describe, expect, it } from 'vitest';

import type { AppUpdateState } from '../../../../../src/shared/update/definitions/updateMessage';
import {
  formatUpdateBytes,
  formatUpdatePercent,
  resolveUpdateEntryPresentation,
} from './resolveUpdateEntryPresentation';

function state(overrides: Partial<AppUpdateState>): AppUpdateState {
  return {
    enabled: true,
    status: 'idle',
    currentVersion: '0.1.0',
    version: '0.1.1',
    releaseNotes: null,
    progress: null,
    failure: null,
    installedVersion: null,
    ...overrides,
  };
}

describe('resolveUpdateEntryPresentation', () => {
  it('非官方发行版与没有更新时不显示入口', () => {
    expect(resolveUpdateEntryPresentation(null)).toBeNull();
    expect(resolveUpdateEntryPresentation(state({ enabled: false, status: 'available' }))).toBeNull();
    expect(resolveUpdateEntryPresentation(state({ status: 'idle' }))).toBeNull();
  });

  it('按状态给出图标、进度、语气和点击方式', () => {
    expect(resolveUpdateEntryPresentation(state({ status: 'available' })))
      .toMatchObject({ shape: 'icon', tone: 'accent', progress: null, opensPanel: false, labelParams: { version: '0.1.1' } });
    expect(resolveUpdateEntryPresentation(state({
      status: 'downloading',
      progress: { fraction: 0.456, transferredBytes: 1, totalBytes: 2, bytesPerSecond: null },
    }))).toMatchObject({ progress: 0.456, labelKey: 'update.entry.downloading', labelParams: { percent: '46%' }, opensPanel: true });
    expect(resolveUpdateEntryPresentation(state({
      status: 'downloading',
      progress: { fraction: null, transferredBytes: 0, totalBytes: null, bytesPerSecond: null },
    }))).toMatchObject({ progress: 0, labelKey: 'update.entry.downloadingUnknown' });
    expect(resolveUpdateEntryPresentation(state({ status: 'paused', progress: { fraction: 0.3, transferredBytes: 3, totalBytes: 10, bytesPerSecond: null } })))
      .toMatchObject({ tone: 'warning', progress: 0.3, opensPanel: true });
    expect(resolveUpdateEntryPresentation(state({ status: 'failed', failure: { kind: 'integrity', retryAt: null } })))
      .toMatchObject({ tone: 'warning', progress: null, opensPanel: true });
    expect(resolveUpdateEntryPresentation(state({ status: 'ready' }))).toMatchObject({ shape: 'pill', labelKey: 'update.entry.ready' });
    expect(resolveUpdateEntryPresentation(state({ status: 'installing' }))).toMatchObject({ shape: 'pill', labelKey: 'update.entry.installing' });
  });

  it('格式化大小与百分比', () => {
    expect(formatUpdateBytes(0)).toBe('0 MB');
    expect(formatUpdateBytes(42.1 * 1024 * 1024)).toBe('42.1 MB');
    expect(formatUpdateBytes(186 * 1024 * 1024)).toBe('186 MB');
    expect(formatUpdatePercent(1.2)).toBe('100%');
  });
});
