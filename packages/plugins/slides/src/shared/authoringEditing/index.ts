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
  SlidesManualEditHistoryStatus,
  SlidesManualEditHistoryFocus,
  SlidesManualEditCommandOperation,
  SlidesManualEditCommandResult,
  SlidesManualEditBuildFailureResult,
  SlidesManualEditCommitResult,
  SlidesManualEditConflictReason,
  SlidesManualEditConflictResult,
  SlidesManualEditExpectedBase,
  SlidesManualEditOperation,
  SlidesManualEditValidationFailureResult,
  SlidesManualSlideInsertOperation,
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
  resolveSlidesAuthoringFrameNodeId,
  isSlidesAuthoringAncestorRefs,
  isSlidesAuthoringEditRef,
  isSlidesAuthoringObjectRef,
  isSlidesAuthoringKey,
} from './functions/authoringIdentity';
export { isSlidesAuthoringEditProjection } from './functions/authoringEditProjection';
export { parseSlidesManualEdits } from './functions/manualEditsCodec';
export type { SlidesManualEditsParseResult } from './functions/manualEditsCodec';

export { authorTextStylePatch, patchWholeTextContent, wholeTextStyle } from './functions/editableTextStyle';
export type { SlidesEditableTextContent, SlidesAuthorTextStyle, SlidesTextStylePatch, SlidesTextSelectionStyle, SlidesTextStyleBase } from './definitions/editableText';
export { isEditableTextContent, isEditableTextRun, isAuthorTextStyle, editableTextString, editableTextEqual } from './functions/editableText';

export { SLIDES_TEXT_STYLE_FIELDS } from './definitions/editableText';
export { readSlidesTextStylePatch } from './functions/readSlidesTextStylePatch';

export type { SlidesInsertedObject } from './definitions/insertedObject';
export { readInsertedObjects } from './functions/readInsertedObjects';
export { readCopyableAuthoringValue } from './functions/readCopyableAuthoringValue';
export { isManualTranslationOnGrid, quantizeManualTranslation, roundToManualTranslationGrid } from './functions/manualTranslationGrid';
export type { SlidesCopyableAuthoringValue } from './functions/readCopyableAuthoringValue';

export { SlidesImportedImageSchema, type SlidesImportedImage } from './definitions/importedImage';
