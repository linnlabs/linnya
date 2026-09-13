export type {
  SlidesAuthoringEditRef,
  SlidesAuthoringObjectRef,
} from './definitions/authoringIdentity';
export type {
  SlidesAuthoringEditCapability,
  SlidesAuthoringEditProjection,
  SlidesAuthoringTextEditProjection,
} from './definitions/authoringEditProjection';
export type {
  SlidesManualEditCommand,
  SlidesManualEditCommandResult,
  SlidesManualEditBuildFailureResult,
  SlidesManualEditCommitResult,
  SlidesManualEditConflictReason,
  SlidesManualEditConflictResult,
  SlidesManualEditExpectedBase,
  SlidesManualEditOperation,
  SlidesManualEditValidationFailureResult,
} from './definitions/manualEditCommand';
export { SLIDES_AUTHORING_KEY_PATTERN } from './definitions/authoringIdentity';
export type {
  SlidesManualAtomicEdit,
  SlidesManualAtomicEditKind,
  SlidesManualEdits,
  SlidesManualEditBase,
  SlidesManualFrameEdit,
  SlidesManualSlideEdits,
  SlidesManualTargetEdit,
  SlidesManualTargetKind,
  SlidesManualTextEdit,
  SlidesManualTranslation,
} from './definitions/manualEdits';
export {
  buildSlidesAuthoringRenderNodeId,
  isSlidesAuthoringAncestorRefs,
  isSlidesAuthoringEditRef,
  isSlidesAuthoringObjectRef,
  isSlidesAuthoringKey,
} from './functions/authoringIdentity';
export { isSlidesAuthoringEditProjection } from './functions/authoringEditProjection';
export { parseSlidesManualEdits } from './functions/manualEditsCodec';
export type { SlidesManualEditsParseResult } from './functions/manualEditsCodec';
