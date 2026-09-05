export {
  PRESENTATION_SOURCE_CHECKPOINT_INTERVAL,
  PresentationSourceConsistencyError,
} from './definitions/presentationSourceRevision.js';
export type {
  BuildPresentationSourceRevisionInput,
  PresentationRevisionStorageKind,
  PresentationSourceRevisionPayload,
  PresentationStoredSourceRevision,
  PresentationSourceCompactionPlan,
} from './definitions/presentationSourceRevision.js';
export {
  PresentationRevisionNotFoundError,
} from './definitions/presentationRevisionRestore.js';
export type {
  PresentationRevisionRestoreCompiler,
  PresentationRevisionSourceReader,
  RestorePresentationRevisionInput,
} from './definitions/presentationRevisionRestore.js';
export {
  buildPresentationSourceRevision,
  hashPresentationSource,
  normalizePresentationSource,
  reconstructPresentationSource,
} from './functions/presentationSourceRevisionCodec.js';
export { restorePresentationRevision } from './orchestration/restorePresentationRevision.js';
export { planPresentationSourceCompaction } from './functions/planPresentationSourceCompaction.js';
