export interface CommandOutputArtifactMaintenanceRequest {
  readonly nowMs: number;
}

export interface CommandOutputArtifactMaintenanceStats {
  readonly scanned: number;
  readonly retained: number;
  readonly deleted: number;
  readonly failed: number;
}
