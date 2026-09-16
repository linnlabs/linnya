export type PresentationManualEditBackendStage =
  | 'request_received'
  | 'receipt_reused'
  | 'snapshot_validated'
  | 'source_rewritten'
  | 'semantic_build_started'
  | 'revision_committed'
  | 'request_rejected';

export interface PresentationManualEditTraceEvent {
  readonly commandId: string;
  readonly documentId: string;
  readonly stage: PresentationManualEditBackendStage;
  readonly path?: 'projected_translation' | 'full_compile';
  readonly outcome?:
    | 'committed'
    | 'conflict'
    | 'validation_failed'
    | 'build_failed'
    | 'infrastructure_failed';
  readonly revision?: number;
}

export interface PresentationManualEditTracePort {
  record(event: PresentationManualEditTraceEvent): void;
}
