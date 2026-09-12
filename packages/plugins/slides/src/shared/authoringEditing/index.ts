export type { SlidesAuthoringEditRef } from './definitions/authoringIdentity';
export type {
  SlidesManualEditCommand,
  SlidesManualEditCommitResult,
  SlidesManualEditExpectedBase,
  SlidesManualEditOperation,
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
  isSlidesAuthoringEditRef,
  isSlidesAuthoringKey,
} from './functions/authoringIdentity';
export { parseSlidesManualEdits } from './functions/manualEditsCodec';
export type { SlidesManualEditsParseResult } from './functions/manualEditsCodec';
