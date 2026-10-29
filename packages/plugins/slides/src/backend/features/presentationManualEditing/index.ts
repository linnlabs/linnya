export {
  SlidesManualEditSourceError,
  writeManualEditsToDeckSource,
  type SlidesManualEditSourceErrorCode,
  type WriteManualEditsToDeckSourceResult,
} from './functions/writeManualEditsToDeckSource.js';
export type { ManualEditDeckProjection } from './definitions/manualEditDeckProjection.js';
export { PRESENTATION_MANUAL_EDIT_SCHEMAS } from './definitions/presentationManualEditSchema.js';
export { createManualEditPayloadDigest } from './functions/createManualEditPayloadDigest.js';
export {
  projectManualTranslationToDeckSpec,
  SlidesManualEditDeckProjectionError,
} from './functions/projectManualTranslationToDeckSpec.js';
export {
  PresentationManualEditingRuntime,
  type PresentationManualEditingRuntimeDeps,
} from './orchestration/PresentationManualEditingRuntime.js';
export { createPresentationManualEditTraceLogger } from './infrastructure/createPresentationManualEditTraceLogger.js';
export type {
  PresentationManualEditBackendStage,
  PresentationManualEditTraceEvent,
  PresentationManualEditTracePort,
} from './definitions/presentationManualEditTrace.js';

export { ManualEditHistoryStore } from './store/manualEditHistoryStore.js';
export { retainedManualEditHistoryVersions } from './functions/manualEditHistory.js';

export { copyManualObjects } from './functions/copyManualObjects';
