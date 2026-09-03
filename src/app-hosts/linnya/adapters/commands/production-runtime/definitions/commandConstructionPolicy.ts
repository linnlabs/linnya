export interface CommandConstructionPolicy {
  readonly defaultHardTimeoutMs: number;
  readonly maximumHardTimeoutMs: number;
  readonly maximumActiveExecutions: number;
}
