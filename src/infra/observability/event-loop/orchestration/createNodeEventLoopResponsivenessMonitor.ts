import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

import type {
  NodeEventLoopResponsivenessMonitor,
  NodeEventLoopResponsivenessSample,
  NodeEventLoopResponsivenessThresholds,
} from '../definitions/nodeEventLoopResponsiveness';
import { projectNodeEventLoopResponsivenessSample } from '../functions/projectNodeEventLoopResponsivenessSample';

export function createNodeEventLoopResponsivenessMonitor(input: {
  readonly component: string;
  readonly sampleIntervalMs: number;
  readonly histogramResolutionMs: number;
  readonly thresholds: NodeEventLoopResponsivenessThresholds;
  readonly onSample: (sample: NodeEventLoopResponsivenessSample) => void;
}): NodeEventLoopResponsivenessMonitor {
  const histogram = monitorEventLoopDelay({
    resolution: input.histogramResolutionMs,
  });
  let interval: NodeJS.Timeout | undefined;
  let startedAtMs = 0;
  let previousUtilization = performance.eventLoopUtilization();

  const sample = (): void => {
    const endedAtMs = Date.now();
    const currentUtilization = performance.eventLoopUtilization();
    const utilization = performance.eventLoopUtilization(
      currentUtilization,
      previousUtilization,
    );
    previousUtilization = currentUtilization;

    input.onSample(projectNodeEventLoopResponsivenessSample({
      component: input.component,
      startedAtMs,
      endedAtMs,
      delay: {
        meanNanoseconds: histogram.mean,
        p50Nanoseconds: histogram.percentile(50),
        p95Nanoseconds: histogram.percentile(95),
        p99Nanoseconds: histogram.percentile(99),
        maximumNanoseconds: histogram.max,
      },
      utilization: {
        activeMilliseconds: utilization.active,
        idleMilliseconds: utilization.idle,
        utilization: utilization.utilization,
      },
      thresholds: input.thresholds,
    }));

    histogram.reset();
    startedAtMs = endedAtMs;
  };

  return Object.freeze({
    start(): void {
      if (interval) return;
      startedAtMs = Date.now();
      previousUtilization = performance.eventLoopUtilization();
      histogram.enable();
      interval = setInterval(sample, input.sampleIntervalMs);
      interval.unref();
    },
    stop(): void {
      if (!interval) return;
      clearInterval(interval);
      interval = undefined;
      histogram.disable();
    },
  });
}
