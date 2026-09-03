export interface VisualRowFixtureGateResult {
  readonly label: string;
  readonly detail: string;
  readonly passed: boolean;
}

export interface VisualRowFixtureGateReport {
  readonly status: 'failed' | 'idle' | 'passed' | 'running';
  readonly results: readonly VisualRowFixtureGateResult[];
}
