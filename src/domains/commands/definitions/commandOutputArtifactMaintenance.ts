export interface CommandOutputArtifactMaintenanceRequest {
  readonly nowMs: number;
  readonly protectedConversationIds?: ReadonlySet<string>;
}

export interface CommandOutputArtifactMaintenanceStats {
  readonly scanned: number;
  readonly retained: number;
  readonly deleted: number;
  readonly failed: number;
}
