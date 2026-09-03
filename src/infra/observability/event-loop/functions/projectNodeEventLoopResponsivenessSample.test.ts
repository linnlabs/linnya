import { describe, expect, it } from 'vitest';

import { projectNodeEventLoopResponsivenessSample } from './projectNodeEventLoopResponsivenessSample';

describe('projectNodeEventLoopResponsivenessSample', () => {
  it('projects Node timing units and reports a breached frontend responsiveness gate', () => {
    expect(projectNodeEventLoopResponsivenessSample({
      component: 'electron-main',
      startedAtMs: 1_000,
      endedAtMs: 6_000,
      delay: {
        meanNanoseconds: 8_000_000,
        p50Nanoseconds: 10_000_000,
        p95Nanoseconds: 20_000_000,
        p99Nanoseconds: 30_000_000,
        maximumNanoseconds: 120_000_000,
      },
      utilization: {
        activeMilliseconds: 800,
        idleMilliseconds: 4_200,
        utilization: 0.16,
      },
      thresholds: {
        p99DelayMs: 25,
        maximumDelayMs: 100,
      },
    })).toEqual({
      component: 'electron-main',
      startedAtMs: 1_000,
      endedAtMs: 6_000,
      delay: {
        meanMs: 8,
        p50Ms: 10,
        p95Ms: 20,
        p99Ms: 30,
        maximumMs: 120,
      },
      utilization: {
        activeMs: 800,
        idleMs: 4_200,
        ratio: 0.16,
      },
      thresholdExceeded: true,
    });
  });

  it('normalizes an empty histogram without manufacturing a failure', () => {
    const sample = projectNodeEventLoopResponsivenessSample({
      component: 'app-server',
      startedAtMs: 10,
      endedAtMs: 20,
      delay: {
        meanNanoseconds: Number.NaN,
        p50Nanoseconds: Number.NaN,
        p95Nanoseconds: Number.NaN,
        p99Nanoseconds: Number.NaN,
        maximumNanoseconds: 0,
      },
      utilization: {
        activeMilliseconds: 0,
        idleMilliseconds: 0,
        utilization: Number.NaN,
      },
      thresholds: {
        p99DelayMs: 50,
        maximumDelayMs: 200,
      },
    });

    expect(sample.delay).toEqual({
      meanMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      maximumMs: 0,
    });
    expect(sample.utilization.ratio).toBe(0);
    expect(sample.thresholdExceeded).toBe(false);
  });
});
