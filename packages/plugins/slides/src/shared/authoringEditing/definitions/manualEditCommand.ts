import type { SlidesAuthoringEditRef } from './authoringIdentity';
import type { SlidesManualTargetKind, SlidesManualTranslation } from './manualEdits';

export interface SlidesManualEditExpectedBase {
  readonly revisionId: string;
  readonly revision: number;
  readonly sourceHash: string;
}

export type SlidesManualEditOperation =
  | {
      readonly op: 'set_text_content';
      readonly target: SlidesAuthoringEditRef;
      readonly content: string;
    }
  | {
      readonly op: 'set_translation';
      readonly target: SlidesAuthoringEditRef;
      readonly targetKind: SlidesManualTargetKind;
      readonly translation: SlidesManualTranslation;
    };

export interface SlidesManualEditCommand {
  readonly commandId: string;
  readonly documentId: string;
  readonly expectedBase: SlidesManualEditExpectedBase;
  readonly operation: SlidesManualEditOperation;
}

export interface SlidesManualEditCommitResult {
  readonly commandId: string;
  readonly documentId: string;
  readonly revisionId: string;
  readonly revision: number;
}

