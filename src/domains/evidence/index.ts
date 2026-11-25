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
  resolveEvidenceFromBundles,
  saveEvidenceBundle,
} from './evidenceDomain';

export type {
  IncompleteRefIssue,
  RefConflict,
  ResolvedEvidenceItem,
  ResolveEvidenceResult,
} from './features/ref-resolution/definitions/evidenceResolution';
