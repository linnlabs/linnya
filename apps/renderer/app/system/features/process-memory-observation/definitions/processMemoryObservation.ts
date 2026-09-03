import type { ElectronProcessMemoryMetric, ElectronProcessMemorySnapshot } from '@app/schemas';

export type ProcessMemoryObservationStatus = 'idle' | 'recording' | 'stopped';

export interface RendererHeapMemory {
  readonly usedMB: number;
  readonly totalMB: number;
  readonly limitMB: number;
}

export interface ProcessMemoryObservationSample {
  readonly label: string;
  readonly snapshot: ElectronProcessMemorySnapshot;
  readonly rendererHeap: RendererHeapMemory | null;
}

export interface ProcessMemoryObservationMarker {
  readonly timestamp: number;
  readonly label: string;
}

export interface ProcessMemoryObservationSummary {
  readonly sampleCount: number;
  readonly durationMs: number;
  readonly baselineWorkingSetMB: number;
  readonly peakWorkingSetMB: number;
  readonly latestWorkingSetMB: number;
  readonly deltaFromBaselineMB: number;
  readonly releasedFromPeakMB: number;
  readonly peakMainExternalMB: number;
  readonly peakMainArrayBuffersMB: number;
  readonly peakRendererHeapMB: number | null;
  readonly largestProcess: ElectronProcessMemoryMetric | null;
}

export interface ProcessMemoryObservationReport {
  readonly schemaVersion: 1;
  readonly session: {
    readonly id: string;
    readonly startedAt: number;
    readonly stoppedAt: number | null;
    readonly intervalMs: number;
  };
  readonly summary: ProcessMemoryObservationSummary | null;
  readonly markers: readonly ProcessMemoryObservationMarker[];
  readonly samples: readonly ProcessMemoryObservationSample[];
}

export interface MemoryTimelineSeries {
  readonly id: 'total' | 'main' | 'renderer' | 'hidden-worker';
  readonly points: string;
}

export interface MemoryTimelineView {
  readonly yMaxMB: number;
  readonly yMidMB: number;
  readonly series: readonly MemoryTimelineSeries[];
}
