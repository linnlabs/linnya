import type { SlidesAuthoringEditRef } from './authoringIdentity';
import type {
  SlidesManualTargetKind,
  SlidesManualTranslation,
  SlidesManualVisualSize,
} from './manualEdits';

export interface SlidesManualEditExpectedBase {
  readonly revisionId: string;
  readonly revision: number;
  readonly sourceHash: string;
}

export type SlidesManualEditOperation =
  | {
      readonly op: 'set_text_content';
      readonly targetKind: 'text' | 'shape';
      readonly target: SlidesAuthoringEditRef;
      readonly content: string;
    }
  | {
      readonly op: 'set_translation';
      readonly target: SlidesAuthoringEditRef;
      readonly targetKind: SlidesManualTargetKind;
      readonly translation: SlidesManualTranslation;
    }
  | {
      readonly op: 'translate_by';
      readonly target: SlidesAuthoringEditRef;
      readonly targetKind: SlidesManualTargetKind;
      readonly delta: SlidesManualTranslation;
    }
  | {
      readonly op: 'set_text_style';
      readonly target: SlidesAuthoringEditRef;
      readonly fontSizePt?: number;
      readonly color?: string;
    }
  | {
      readonly op: 'set_fill_color';
      readonly target: SlidesAuthoringEditRef;
      readonly targetKind: 'frame' | 'shape';
      readonly color: string;
    }
  | {
      readonly op: 'set_visual_size';
      readonly target: SlidesAuthoringEditRef;
      readonly targetKind: 'shape' | 'image';
      readonly visualSize: SlidesManualVisualSize;
    }
  | {
      readonly op: 'delete_target';
      readonly target: SlidesAuthoringEditRef;
      readonly targetKind: SlidesManualTargetKind;
    };

export interface SlidesManualEditCommand {
  readonly commandId: string;
  readonly documentId: string;
  readonly expectedBase: SlidesManualEditExpectedBase;
  readonly operation: SlidesManualEditOperation;
}

export interface SlidesManualEditCommitResult {
  readonly status: 'committed';
  readonly commandId: string;
  readonly documentId: string;
  readonly revisionId: string;
  readonly revision: number;
}

export type SlidesManualEditConflictReason =
  | 'stale_base'
  | 'draft_present'
  | 'command_reused';

export interface SlidesManualEditConflictResult {
  readonly status: 'conflict';
  readonly commandId: string;
  readonly documentId: string;
  readonly reason: SlidesManualEditConflictReason;
}

export interface SlidesManualEditValidationFailureResult {
  readonly status: 'validation_failed';
  readonly commandId: string;
  readonly documentId: string;
  readonly code: string;
  readonly message: string;
}

export interface SlidesManualEditBuildFailureResult {
  readonly status: 'build_failed';
  readonly commandId: string;
  readonly documentId: string;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly referenceId?: string;
}

export type SlidesManualEditCommandResult =
  | SlidesManualEditCommitResult
  | SlidesManualEditConflictResult
  | SlidesManualEditValidationFailureResult
  | SlidesManualEditBuildFailureResult;
