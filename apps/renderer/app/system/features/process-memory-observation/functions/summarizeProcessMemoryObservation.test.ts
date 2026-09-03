import { describe, expect, it } from 'vitest';
import type { ElectronProcessMemorySnapshot } from '@app/schemas';
import type { ProcessMemoryObservationSample } from '../definitions/processMemoryObservation';
import { summarizeProcessMemoryObservation } from './summarizeProcessMemoryObservation';

function sample(input: {
  readonly timestamp: number;
  readonly total: number;
  readonly mainExternal: number;
  readonly mainArrayBuffers: number;
  readonly rendererHeap?: number;
  readonly processWorkingSet: number;
}): ProcessMemoryObservationSample {
  const snapshot: ElectronProcessMemorySnapshot = {
    success: true,
    timestamp: input.timestamp,
    totalWorkingSetMB: input.total,
    totalPrivateMB: null,
    mainProcess: {
      rssMB: 10,
      heapUsedMB: 5,
      externalMB: input.mainExternal,
      arrayBuffersMB: input.mainArrayBuffers,
    },
    system: { totalMB: 100, freeMB: 50 },
    metrics: [
      {
        pid: 1,
        type: 'Browser',
        role: 'main',
        ownerId: 'electron-main',
        workingSetMB: input.processWorkingSet,
        peakWorkingSetMB: input.processWorkingSet,
        privateMB: null,
        cpuPercent: 0,
        creationTime: 1,
      },
    ],
  };
  return {
    label: 'interval',
    snapshot,
    rendererHeap:
      input.rendererHeap === undefined
        ? null
        : {
            usedMB: input.rendererHeap,
            totalMB: input.rendererHeap,
            limitMB: 100,
          },
  };
}

describe('summarizeProcessMemoryObservation', () => {
  it('区分基线、峰值、结束值和回落量，并保留主进程外部内存峰值', () => {
    const summary = summarizeProcessMemoryObservation([
      sample({
        timestamp: 1_000,
        total: 500,
        mainExternal: 20,
        mainArrayBuffers: 10,
        rendererHeap: 40,
        processWorkingSet: 200,
      }),
      sample({
        timestamp: 2_000,
        total: 1_800,
        mainExternal: 700,
        mainArrayBuffers: 650,
        rendererHeap: 90,
        processWorkingSet: 900,
      }),
      sample({
        timestamp: 4_000,
        total: 800,
        mainExternal: 100,
        mainArrayBuffers: 80,
        rendererHeap: 60,
        processWorkingSet: 300,
      }),
    ]);

    expect(summary).toMatchObject({
      sampleCount: 3,
      durationMs: 3_000,
      baselineWorkingSetMB: 500,
      peakWorkingSetMB: 1_800,
      latestWorkingSetMB: 800,
      deltaFromBaselineMB: 300,
      releasedFromPeakMB: 1_000,
      peakMainExternalMB: 700,
      peakMainArrayBuffersMB: 650,
      peakRendererHeapMB: 90,
    });
    expect(summary?.largestProcess?.workingSetMB).toBe(900);
  });
});
