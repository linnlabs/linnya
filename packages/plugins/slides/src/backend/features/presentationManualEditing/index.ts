export {
  SlidesManualEditSourceError,
  writeManualEditsToDeckSource,
  type SlidesManualEditSourceErrorCode,
  type WriteManualEditsToDeckSourceResult,
} from './functions/writeManualEditsToDeckSource.js';
export { PRESENTATION_MANUAL_EDIT_SCHEMAS } from './definitions/presentationManualEditSchema.js';
export { createManualEditPayloadDigest } from './functions/createManualEditPayloadDigest.js';
export {
  PresentationManualEditingRuntime,
  type PresentationManualEditingRuntimeDeps,
} from './orchestration/PresentationManualEditingRuntime.js';
