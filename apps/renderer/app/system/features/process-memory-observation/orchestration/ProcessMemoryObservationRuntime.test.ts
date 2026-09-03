import { describe, expect, it, vi } from 'vitest';
import type { ProcessMemoryObservationSample } from '../definitions/processMemoryObservation';
import type { ProcessMemoryObservationGateway } from '../infrastructure/processMemoryObservationGateway';
import { ProcessMemoryObservationRuntime } from './ProcessMemoryObservationRuntime';

function createSample(label: string, timestamp: number): ProcessMemoryObservationSample {
  return {
    label,
    rendererHeap: null,
    snapshot: {
      success: true,
      timestamp,
      totalWorkingSetMB: 100,
      totalPrivateMB: null,
      mainProcess: { rssMB: 10, heapUsedMB: 5, externalMB: 2, arrayBuffersMB: 1 },
      system: { totalMB: 1_000, freeMB: 500 },
      metrics: [],
    },
  };
}

describe('ProcessMemoryObservationRuntime', () => {
  it('录制开始和停止都采样，并在中间按固定间隔采样', async () => {
    let timestamp = 0;
    const gateway: ProcessMemoryObservationGateway = {
      readSample: vi.fn(async label => createSample(label, ++timestamp)),
    };
    let intervalCallback!: () => void;
    const clearInterval = vi.fn();
    const runtime = new ProcessMemoryObservationRuntime(gateway, {
      setInterval: (callback) => {
        intervalCallback = callback;
        return 7;
      },
      clearInterval,
    });
    const samples: ProcessMemoryObservationSample[] = [];

    await runtime.start(1000, {
      onSample: sample => samples.push(sample),
      onFailure: vi.fn(),
    });
    intervalCallback();
    await runtime.stop();

    expect(samples.map(sample => sample.label)).toEqual([
      'recording-start',
      'interval',
      'recording-stop',
    ]);
    expect(clearInterval).toHaveBeenCalledWith(7);
  });
});
