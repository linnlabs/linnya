import type {
  ProcessMemoryObservationReport,
  ProcessMemoryObservationSample,
} from '../definitions/processMemoryObservation';
import { buildProcessMemoryObservationReport } from '../functions/buildProcessMemoryObservationReport';
import { useProcessMemoryObservationStore } from '../store/processMemoryObservationStore';
import {
  clearProcessMemoryObservation,
  markProcessMemoryObservation,
  sampleProcessMemoryObservation,
  startProcessMemoryObservation,
  stopProcessMemoryObservation,
} from './processMemoryObservationSession';

export interface ProcessMemoryObservationDevApi {
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<void>;
  readonly sample: (label?: string) => Promise<void>;
  readonly mark: (label: string) => void;
  readonly clear: () => void;
  readonly getLatestSample: () => ProcessMemoryObservationSample | null;
  readonly getReport: () => ProcessMemoryObservationReport;
}

declare global {
  interface Window {
    __LINNYA_MEMORY_DIAGNOSTICS__?: ProcessMemoryObservationDevApi;
  }
}

export function installProcessMemoryObservationDevApi(): void {
  if (!import.meta.env.DEV) return;
  window.__LINNYA_MEMORY_DIAGNOSTICS__ = {
    start: startProcessMemoryObservation,
    stop: stopProcessMemoryObservation,
    sample: sampleProcessMemoryObservation,
    mark: markProcessMemoryObservation,
    clear: clearProcessMemoryObservation,
    getLatestSample: () => {
      const sample = useProcessMemoryObservationStore().latestSample;
      return sample ? structuredClone(sample) : null;
    },
    getReport: () => {
      const store = useProcessMemoryObservationStore();
      return structuredClone(buildProcessMemoryObservationReport({
        sessionId: store.sessionId,
        startedAt: store.startedAt,
        stoppedAt: store.stoppedAt,
        intervalMs: store.intervalMs,
        samples: store.samples,
        markers: store.markers,
      }));
    },
  };
}
