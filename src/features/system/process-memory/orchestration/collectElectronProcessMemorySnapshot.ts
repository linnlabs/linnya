import os from 'node:os';
import { app } from 'electron';
import { listHiddenWorkerProcessIdentities } from '../../../../electron-main/hidden-worker/hiddenWorkerRuntime.js';
import type { ElectronProcessMetricFact } from '../definitions/processMemorySource.js';
import { buildProcessMemorySnapshot } from '../functions/buildProcessMemorySnapshot.js';

function readMetricFact(metric: Electron.ProcessMetric): ElectronProcessMetricFact {
  return {
    pid: metric.pid,
    type: metric.type,
    ...(metric.name ? { name: metric.name } : {}),
    ...(metric.serviceName ? { serviceName: metric.serviceName } : {}),
    workingSetKb: metric.memory.workingSetSize,
    peakWorkingSetKb: metric.memory.peakWorkingSetSize,
    privateKb: typeof metric.memory.privateBytes === 'number' ? metric.memory.privateBytes : null,
    cpuPercent: metric.cpu.percentCPUUsage,
    creationTime: metric.creationTime,
    ...(metric.sandboxed === undefined ? {} : { sandboxed: metric.sandboxed }),
  };
}

export function collectElectronProcessMemorySnapshot(
  requestingRendererPid: number,
  timestamp = Date.now()
) {
  const mainMemory = process.memoryUsage();
  return buildProcessMemorySnapshot({
    timestamp,
    mainPid: process.pid,
    requestingRendererPid,
    hiddenWorkers: listHiddenWorkerProcessIdentities(),
    metrics: app.getAppMetrics().map(readMetricFact),
    mainProcessBytes: {
      rss: mainMemory.rss,
      heapUsed: mainMemory.heapUsed,
      external: mainMemory.external,
      arrayBuffers: mainMemory.arrayBuffers,
    },
    systemBytes: {
      total: os.totalmem(),
      free: os.freemem(),
    },
  });
}
