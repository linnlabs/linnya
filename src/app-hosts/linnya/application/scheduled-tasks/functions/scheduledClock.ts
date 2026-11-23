import type { ScheduledTaskPorts } from '../definitions/scheduledTaskRuntime';

const DAY_MS = 86_400_000;

export function readScheduledClock(ports: Pick<ScheduledTaskPorts, 'now' | 'buildTime' | 'store'>) {
  const now = ports.now();
  const latest = ports.store.latestClockEvidence() ?? 0;
  const expectedAfter = Math.max(ports.buildTime ?? 0, latest - DAY_MS);
  return {
    now,
    anomaly: now < expectedAfter ? { now, expected_after: expectedAfter } : undefined,
    trustedReference: Math.max(now, latest, ports.buildTime ?? 0),
  };
}

export function elapsedSince(now: number, since: number): number {
  return Math.max(0, now - since);
}
