export type {
  SlidesAuthoringEditRef,
  SlidesAuthoringObjectRef,
} from './definitions/authoringIdentity';
export type {
  SlidesAuthoringEditCapability,
  SlidesAuthoringFillEditProjection,
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
export { SLIDES_MANUAL_FONT_SIZE_PT } from './definitions/textStyleLimits';
export type {
  SlidesManualAtomicEdit,
  SlidesManualAtomicEditKind,
  SlidesManualEdits,
  SlidesManualEditsInput,
  SlidesManualEditBase,
  SlidesManualFrameEdit,
  SlidesManualImageEdit,
  SlidesManualShapeEdit,
  SlidesManualSlideEdits,
  SlidesManualTargetEdit,
  SlidesManualTargetKind,
  SlidesManualTextEdit,
  SlidesManualTranslation,
  SlidesManualTranslationOnlyEdit,
  SlidesManualTranslationOnlyEditKind,
  SlidesManualVisualSize,
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
