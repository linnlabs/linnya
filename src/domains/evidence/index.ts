/**
 * Evidence domain 公开合同。
 *
 * 跨领域调用方只从这里引用稳定类型和 ref-resolution 能力，
 * 不穿透 features 内部目录。
 */
export type {
  EvidenceSourceType,
  KnowledgeEvidenceCaptureKind,
  KnowledgeBaseEvidenceItem,
  WebEvidenceCaptureKind,
  WebEvidenceItem,
} from './definitions/evidence';

export {
  listEvidenceRefs,
  resolveEvidenceFromBundles,
  saveEvidenceBundle,
} from './evidenceDomain';

export {
  buildEvidenceRefListObservation,
  buildEvidenceResolutionObservation,
} from './features/ref-resolution/functions/buildEvidenceResolutionObservation';

export type {
  EvidenceRefListItem,
  ListEvidenceRefsResult,
} from './features/ref-resolution/orchestration/listEvidenceRefs';

export type {
  IncompleteRefIssue,
  RefConflict,
  ResolvedEvidenceItem,
  ResolveEvidenceResult,
} from './features/ref-resolution/definitions/evidenceResolution';
