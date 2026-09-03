import type {
  NodeEventLoopResponsivenessSample,
  NodeEventLoopResponsivenessThresholds,
} from '../definitions/nodeEventLoopResponsiveness';

const NANOSECONDS_PER_MILLISECOND = 1_000_000;

export interface NodeEventLoopDelaySnapshot {
  readonly meanNanoseconds: number;
  readonly p50Nanoseconds: number;
  readonly p95Nanoseconds: number;
  readonly p99Nanoseconds: number;
  readonly maximumNanoseconds: number;
}

export interface NodeEventLoopUtilizationSnapshot {
  readonly activeMilliseconds: number;
  readonly idleMilliseconds: number;
  readonly utilization: number;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function nanosecondsToMilliseconds(value: number): number {
  return finiteOrZero(value) / NANOSECONDS_PER_MILLISECOND;
}

export function projectNodeEventLoopResponsivenessSample(input: {
  readonly component: string;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly delay: NodeEventLoopDelaySnapshot;
  readonly utilization: NodeEventLoopUtilizationSnapshot;
  readonly thresholds: NodeEventLoopResponsivenessThresholds;
}): NodeEventLoopResponsivenessSample {
  const p99Ms = nanosecondsToMilliseconds(input.delay.p99Nanoseconds);
  const maximumMs = nanosecondsToMilliseconds(input.delay.maximumNanoseconds);

  return Object.freeze({
    component: input.component,
    startedAtMs: input.startedAtMs,
    endedAtMs: input.endedAtMs,
    delay: Object.freeze({
      meanMs: nanosecondsToMilliseconds(input.delay.meanNanoseconds),
      p50Ms: nanosecondsToMilliseconds(input.delay.p50Nanoseconds),
      p95Ms: nanosecondsToMilliseconds(input.delay.p95Nanoseconds),
      p99Ms,
      maximumMs,
    }),
    utilization: Object.freeze({
      activeMs: finiteOrZero(input.utilization.activeMilliseconds),
      idleMs: finiteOrZero(input.utilization.idleMilliseconds),
      ratio: finiteOrZero(input.utilization.utilization),
    }),
    thresholdExceeded:
      p99Ms > input.thresholds.p99DelayMs
      || maximumMs > input.thresholds.maximumDelayMs,
  });
}
