import type { ElectronProcessMemorySnapshot } from '@app/schemas';

export interface ElectronProcessMetricFact {
  readonly pid: number;
  readonly type: string;
  readonly name?: string;
  readonly serviceName?: string;
  readonly workingSetKb: number;
  readonly peakWorkingSetKb: number;
  readonly privateKb: number | null;
  readonly cpuPercent: number;
  readonly creationTime: number;
  readonly sandboxed?: boolean;
}

export interface HiddenWorkerProcessIdentity {
  readonly workerId: string;
  readonly pid: number;
}

export interface ProcessMemorySnapshotInput {
  readonly timestamp: number;
  readonly mainPid: number;
  readonly requestingRendererPid: number;
  readonly hiddenWorkers: readonly HiddenWorkerProcessIdentity[];
  readonly metrics: readonly ElectronProcessMetricFact[];
  readonly mainProcessBytes: {
    readonly rss: number;
    readonly heapUsed: number;
    readonly external: number;
    readonly arrayBuffers: number;
  };
  readonly systemBytes: {
    readonly total: number;
    readonly free: number;
  };
}

export type ProcessMemorySnapshot = ElectronProcessMemorySnapshot;
