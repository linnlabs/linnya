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
  buildPresentationSourceRevision,
  hashPresentationSource,
  normalizePresentationSource,
  reconstructPresentationSource,
} from './functions/presentationSourceRevisionCodec.js';
export { planPresentationSourceCompaction } from './functions/planPresentationSourceCompaction.js';
export { PresentationRevisionScope, type PresentationRevisionAsset } from './orchestration/PresentationRevisionScope';
export { PRESENTATION_HISTORY_SCHEMAS } from './definitions/presentationHistorySchema';
export { PresentationHistoryRepository, type PresentationHistorySnapshot } from './infrastructure/PresentationHistoryRepository';
export { PresentationHistoryRuntime } from './orchestration/PresentationHistoryRuntime';
export { observeRevisionImageBindings, observeRevisionSvgBindings } from './functions/observeRevisionBindings';
