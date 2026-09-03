import { describe, expect, it } from 'vitest';
import type { ElectronProcessMetricFact } from '../definitions/processMemorySource';
import { buildProcessMemorySnapshot } from './buildProcessMemorySnapshot';

function metric(
  input: Partial<ElectronProcessMetricFact> & Pick<ElectronProcessMetricFact, 'pid' | 'type'>
): ElectronProcessMetricFact {
  return {
    workingSetKb: 1024,
    peakWorkingSetKb: 2048,
    privateKb: 512,
    cpuPercent: 1.25,
    creationTime: 1,
    ...input,
  };
}

describe('buildProcessMemorySnapshot', () => {
  it('把主进程、调用窗口、GPU 与隐藏 Worker 投影成可分析的稳定身份', () => {
    const snapshot = buildProcessMemorySnapshot({
      timestamp: 100,
      mainPid: 11,
      requestingRendererPid: 22,
      hiddenWorkers: [{ workerId: 'slides-raster', pid: 33 }],
      metrics: [
        metric({ pid: 11, type: 'Browser', workingSetKb: 4096 }),
        metric({ pid: 22, type: 'Tab', workingSetKb: 3072 }),
        metric({ pid: 33, type: 'Tab', workingSetKb: 8192 }),
        metric({ pid: 44, type: 'GPU', workingSetKb: 2048 }),
      ],
      mainProcessBytes: {
        rss: 10 * 1024 * 1024,
        heapUsed: 4 * 1024 * 1024,
        external: 3 * 1024 * 1024,
        arrayBuffers: 2 * 1024 * 1024,
      },
      systemBytes: {
        total: 32 * 1024 * 1024,
        free: 8 * 1024 * 1024,
      },
    });

    expect(snapshot.totalWorkingSetMB).toBe(17);
    expect(snapshot.metrics.map(item => [item.pid, item.role, item.ownerId])).toEqual([
      [33, 'hidden-worker', 'slides-raster'],
      [11, 'main', 'electron-main'],
      [22, 'app-renderer', 'main-window'],
      [44, 'gpu', null],
    ]);
    expect(snapshot.mainProcess).toEqual({
      rssMB: 10,
      heapUsedMB: 4,
      externalMB: 3,
      arrayBuffersMB: 2,
    });
  });

  it('只有 Electron 提供私有内存时才汇总 totalPrivateMB', () => {
    const snapshot = buildProcessMemorySnapshot({
      timestamp: 100,
      mainPid: 1,
      requestingRendererPid: 2,
      hiddenWorkers: [],
      metrics: [metric({ pid: 1, type: 'Browser', privateKb: null })],
      mainProcessBytes: { rss: 0, heapUsed: 0, external: 0, arrayBuffers: 0 },
      systemBytes: { total: 0, free: 0 },
    });

    expect(snapshot.totalPrivateMB).toBeNull();
  });
});
