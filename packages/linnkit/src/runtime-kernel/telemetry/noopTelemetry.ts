import type { TelemetryPort } from './telemetryPort';

export const noopTelemetry: TelemetryPort = {
  emit(): void {
    // Intentionally empty: optional capability should preserve current behavior by default.
  },
  async flush(): Promise<void> {
    // No buffered state.
  },
};
