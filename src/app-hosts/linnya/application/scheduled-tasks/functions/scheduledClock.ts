import type { ScheduledTaskPorts } from '../definitions/scheduledTaskRuntime';

const DAY_MS = 86_400_000;

export function readScheduledClock(ports: Pick<ScheduledTaskPorts, 'now' | 'buildTime' | 'store'>) {
  const now = ports.now();
  const latest = ports.store.latestClockEvidence() ?? 0;
  // 有构建时刻就只信它：库里的时间戳可能写于一段跑快了的时钟（误调到几年后），
  // 拿它当下限会让改回正确时间后一直判成异常。没有构建时刻（直接导入源码的宿主）才退回库里证据。
  const expectedAfter = ports.buildTime ?? latest - DAY_MS;
  return {
    now,
    anomaly: now < expectedAfter ? { now, expected_after: expectedAfter } : undefined,
    trustedReference: Math.max(now, latest, ports.buildTime ?? 0),
  };
}

export function elapsedSince(now: number, since: number): number {
  return Math.max(0, now - since);
}
