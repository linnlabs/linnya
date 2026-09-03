export type {
  CitationSequence,
  CitationSequenceEvent,
} from './features/sequence/definitions/citationSequence';
export { computeTurnCitationOffset } from './features/sequence/functions/computeTurnCitationOffset';
export {
  attachCitationSequence,
  copyCitationSequence,
  requireCitationSequenceOffset,
} from './features/sequence/orchestration/citationSequenceContext';
export type {
  CitationRefAllocatorPort,
  CitationRefClaim,
  CitationRefClaimStorePort,
  CitationRefClaimTransactionPort,
} from './features/reference/definitions/citationRefAllocator';
export {
  allocateCitationRefs,
  createCitationRefAllocator,
} from './features/reference/orchestration/allocateCitationRefs';
export {
  attachCitationRefAllocator,
  copyCitationRefAllocator,
  requireCitationRefAllocator,
} from './features/reference/orchestration/citationRefAllocatorContext';
export {
  formatCitationRef,
  isCanonicalCitationRef,
  normalizeCitationRef,
} from './features/reference/functions/citationRef';
export type {
  DocumentCitationAppendixBudget,
  DocumentCitationAppendixResult,
  DocumentCitationAppendixSourceExcerpt,
  DocumentCitationDiagnostic,
  DocumentCitationDiagnosticCode,
  DocumentCitationNodeSnapshot,
  DocumentCitationProjection,
  DocumentCitationSource,
  DocumentKnowledgeCitationSource,
  DocumentManualCitationSource,
  DocumentWebCitationSource,
} from './features/document-read/definitions/documentCitationProjection';
export type { MarkdownCitationToken } from './features/document-read/definitions/markdownCitationToken';
export { DEFAULT_DOCUMENT_CITATION_APPENDIX_BUDGET } from './features/document-read/definitions/documentCitationProjection';
export {
  admitDocumentCitationNodeSnapshots,
  admitDocumentCitations,
  collectDocumentCitationNodeSnapshots,
} from './features/document-read/functions/admitDocumentCitations';
export { buildDocumentCitationAppendix } from './features/document-read/functions/buildDocumentCitationAppendix';
export { selectDocumentCitationSourcesForBodyWindow } from './features/document-read/functions/selectDocumentCitationSourcesForBodyWindow';
export { selectDocumentCitationDiagnosticsForBodyWindow } from './features/document-read/functions/selectDocumentCitationDiagnosticsForBodyWindow';
export {
  extractCanonicalCitationRefs,
  findInvalidMarkdownCitationTokens,
  parseMarkdownCitationTokens,
} from './features/document-read/functions/parseMarkdownCitationTokens';
export { projectMarkdownCitationTokens } from './features/document-read/functions/projectMarkdownCitationTokens';
export { normalizeMarkdownCitationTokenSpelling } from './features/document-read/functions/normalizeMarkdownCitationTokenSpelling';
export { maskMarkdownCitationTokens } from './features/document-read/functions/maskMarkdownCitationTokens';
export type {
  CitationSource,
  CitationSourceResolverPort,
  KnowledgeCitationSource,
  WebCitationSource,
} from './features/source-resolution/definitions/citationSource';
export { admitCitationSources } from './features/source-resolution/functions/admitCitationSources';
export { projectSearchResultCitationSource } from './features/source-resolution/functions/projectSearchResultCitationSource';
export type { CitationSourceAnchor } from './shared/definitions/citationSourceAnchor';
export {
  admitCitationSourceAnchor,
  createCitationSourceIdentity,
} from './shared/functions/citationSourceAnchor';
export {
  attachCitationSourceResolver,
  copyCitationSourceResolver,
  requireCitationSourceResolver,
} from './features/source-resolution/orchestration/citationSourceResolverContext';
export { readHistoricalCitationSnapshotBundle } from './features/snapshot-history/infrastructure/readHistoricalCitationSnapshotBundle';
