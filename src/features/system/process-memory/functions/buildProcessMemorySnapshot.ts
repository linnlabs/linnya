import type { ElectronProcessMemoryMetric, ElectronProcessRole } from '@app/schemas';
import type {
  ElectronProcessMetricFact,
  HiddenWorkerProcessIdentity,
  ProcessMemorySnapshot,
  ProcessMemorySnapshotInput,
} from '../definitions/processMemorySource';

const KILOBYTES_PER_MEGABYTE = 1024;
const BYTES_PER_MEGABYTE = 1024 * 1024;

function roundMegabytes(value: number): number {
  return Math.round(value * 10) / 10;
}

function kbToMB(value: number): number {
  return roundMegabytes(value / KILOBYTES_PER_MEGABYTE);
}

function bytesToMB(value: number): number {
  return roundMegabytes(value / BYTES_PER_MEGABYTE);
}

function sum(values: readonly number[]): number {
  return roundMegabytes(values.reduce((total, value) => total + value, 0));
}

function resolveRole(input: {
  readonly metric: ElectronProcessMetricFact;
  readonly mainPid: number;
  readonly requestingRendererPid: number;
  readonly hiddenWorkersByPid: ReadonlyMap<number, HiddenWorkerProcessIdentity>;
}): Pick<ElectronProcessMemoryMetric, 'role' | 'ownerId'> {
  if (input.metric.pid === input.mainPid) {
    return { role: 'main', ownerId: 'electron-main' };
  }
  if (input.metric.pid === input.requestingRendererPid) {
    return { role: 'app-renderer', ownerId: 'main-window' };
  }
  const hiddenWorker = input.hiddenWorkersByPid.get(input.metric.pid);
  if (hiddenWorker) {
    return { role: 'hidden-worker', ownerId: hiddenWorker.workerId };
  }
  const role: ElectronProcessRole =
    input.metric.type === 'GPU' ? 'gpu' : input.metric.type === 'Utility' ? 'utility' : 'other';
  return { role, ownerId: null };
}

function projectMetric(
  fact: ElectronProcessMetricFact,
  input: ProcessMemorySnapshotInput,
  hiddenWorkersByPid: ReadonlyMap<number, HiddenWorkerProcessIdentity>
): ElectronProcessMemoryMetric {
  return {
    pid: fact.pid,
    type: fact.type,
    ...resolveRole({
      metric: fact,
      mainPid: input.mainPid,
      requestingRendererPid: input.requestingRendererPid,
      hiddenWorkersByPid,
    }),
    ...(fact.name ? { name: fact.name } : {}),
    ...(fact.serviceName ? { serviceName: fact.serviceName } : {}),
    workingSetMB: kbToMB(fact.workingSetKb),
    peakWorkingSetMB: kbToMB(fact.peakWorkingSetKb),
    privateMB: fact.privateKb === null ? null : kbToMB(fact.privateKb),
    cpuPercent: roundMegabytes(fact.cpuPercent),
    creationTime: fact.creationTime,
    ...(fact.sandboxed === undefined ? {} : { sandboxed: fact.sandboxed }),
  };
}

export function buildProcessMemorySnapshot(
  input: ProcessMemorySnapshotInput
): ProcessMemorySnapshot {
  const hiddenWorkersByPid = new Map(
    input.hiddenWorkers.map(worker => [worker.pid, worker] as const)
  );
  const metrics = input.metrics
    .map(metric => projectMetric(metric, input, hiddenWorkersByPid))
    .sort((left, right) => right.workingSetMB - left.workingSetMB);
  const privateValues = metrics.flatMap(metric =>
    metric.privateMB === null ? [] : [metric.privateMB]
  );

  return {
    success: true,
    timestamp: input.timestamp,
    totalWorkingSetMB: sum(metrics.map(metric => metric.workingSetMB)),
    totalPrivateMB: privateValues.length === 0 ? null : sum(privateValues),
    mainProcess: {
      rssMB: bytesToMB(input.mainProcessBytes.rss),
      heapUsedMB: bytesToMB(input.mainProcessBytes.heapUsed),
      externalMB: bytesToMB(input.mainProcessBytes.external),
      arrayBuffersMB: bytesToMB(input.mainProcessBytes.arrayBuffers),
    },
    system: {
      totalMB: bytesToMB(input.systemBytes.total),
      freeMB: bytesToMB(input.systemBytes.free),
    },
    metrics,
  };
}
