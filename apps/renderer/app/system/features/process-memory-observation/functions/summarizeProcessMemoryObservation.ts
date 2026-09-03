import type { ElectronProcessMemoryMetric } from '@app/schemas';
import type {
  ProcessMemoryObservationSample,
  ProcessMemoryObservationSummary,
} from '../definitions/processMemoryObservation';

function max(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function findLargestProcess(
  samples: readonly ProcessMemoryObservationSample[]
): ElectronProcessMemoryMetric | null {
  let largest: ElectronProcessMemoryMetric | null = null;
  for (const sample of samples) {
    for (const metric of sample.snapshot.metrics) {
      if (!largest || metric.workingSetMB > largest.workingSetMB) largest = metric;
    }
  }
  return largest;
}

export function summarizeProcessMemoryObservation(
  samples: readonly ProcessMemoryObservationSample[]
): ProcessMemoryObservationSummary | null {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last) return null;

  const peakWorkingSetMB = max(samples.map(sample => sample.snapshot.totalWorkingSetMB));
  const rendererHeapValues = samples.flatMap(sample =>
    sample.rendererHeap ? [sample.rendererHeap.usedMB] : []
  );

  return {
    sampleCount: samples.length,
    durationMs: Math.max(0, last.snapshot.timestamp - first.snapshot.timestamp),
    baselineWorkingSetMB: first.snapshot.totalWorkingSetMB,
    peakWorkingSetMB,
    latestWorkingSetMB: last.snapshot.totalWorkingSetMB,
    deltaFromBaselineMB: round(last.snapshot.totalWorkingSetMB - first.snapshot.totalWorkingSetMB),
    releasedFromPeakMB: round(peakWorkingSetMB - last.snapshot.totalWorkingSetMB),
    peakMainExternalMB: max(samples.map(sample => sample.snapshot.mainProcess.externalMB)),
    peakMainArrayBuffersMB: max(samples.map(sample => sample.snapshot.mainProcess.arrayBuffersMB)),
    peakRendererHeapMB: rendererHeapValues.length === 0 ? null : max(rendererHeapValues),
    largestProcess: findLargestProcess(samples),
  };
}
