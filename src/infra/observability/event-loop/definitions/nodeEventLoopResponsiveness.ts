export interface NodeEventLoopResponsivenessThresholds {
  readonly p99DelayMs: number;
  readonly maximumDelayMs: number;
}

export interface NodeEventLoopResponsivenessSample {
  readonly component: string;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly delay: {
    readonly meanMs: number;
    readonly p50Ms: number;
    readonly p95Ms: number;
    readonly p99Ms: number;
    readonly maximumMs: number;
  };
  readonly utilization: {
    readonly activeMs: number;
    readonly idleMs: number;
    readonly ratio: number;
  };
  readonly thresholdExceeded: boolean;
}

export interface NodeEventLoopResponsivenessMonitor {
  start(): void;
  stop(): void;
}
