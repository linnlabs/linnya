import type {
  ProcessMemoryObservationMarker,
  ProcessMemoryObservationReport,
  ProcessMemoryObservationSample,
} from '../definitions/processMemoryObservation';
import { summarizeProcessMemoryObservation } from './summarizeProcessMemoryObservation';

export function buildProcessMemoryObservationReport(input: {
  readonly sessionId: string;
  readonly startedAt: number;
  readonly stoppedAt: number | null;
  readonly intervalMs: number;
  readonly samples: readonly ProcessMemoryObservationSample[];
  readonly markers: readonly ProcessMemoryObservationMarker[];
}): ProcessMemoryObservationReport {
  return {
    schemaVersion: 1,
    session: {
      id: input.sessionId,
      startedAt: input.startedAt,
      stoppedAt: input.stoppedAt,
      intervalMs: input.intervalMs,
    },
    summary: summarizeProcessMemoryObservation(input.samples),
    markers: input.markers,
    samples: input.samples,
  };
}
