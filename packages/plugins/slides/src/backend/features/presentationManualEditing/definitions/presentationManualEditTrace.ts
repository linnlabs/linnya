import type { SlidesManualEditCommandOperation } from '@plugin/slides/shared/authoringEditing';
import type { CodegenDeckBuildPhase } from '../../../codegen';
export type PresentationManualEditBackendStage =
  | 'request_received'
  | 'scope_acquired'
  | 'build_progress'
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
  readonly path?: 'history_restore' | 'projected_edit' | 'projected_slide_insertion' | 'full_compile';
  readonly outcome?:
    | 'committed'
    | 'conflict'
    | 'validation_failed'
    | 'build_failed'
    | 'infrastructure_failed';
  readonly revision?: number;
  readonly operation?: SlidesManualEditCommandOperation['op'];
  readonly buildPhase?: CodegenDeckBuildPhase;
  readonly slideCount?: number;
  readonly compiledRootCount?: number;
}

export interface PresentationManualEditTracePort {
  record(event: PresentationManualEditTraceEvent): void;
}
