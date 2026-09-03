import type {
  CompleteEvidenceCandidate,
  ResolvedEvidenceItem,
} from '../definitions/evidenceResolution';

export type EvidenceCandidateDecision = 'keep_existing' | 'replace_existing' | 'conflict';

function isSameEvidencePointer(
  existing: ResolvedEvidenceItem,
  incoming: CompleteEvidenceCandidate
): boolean {
  if (existing.source_type !== incoming.source_type) return false;
  if (incoming.source_type === 'knowledge_base') {
    return existing.doc_id === incoming.doc_id && existing.block_id === incoming.block_id;
  }
  return existing.url === incoming.url;
}

function getKnowledgeEvidenceQuality(candidate: {
  readonly capture_kind?: ResolvedEvidenceItem['capture_kind'];
}): number {
  if (candidate.capture_kind === 'knowledge_document_chunk') return 2;
  if (
    candidate.capture_kind === 'knowledge_search_result' ||
    candidate.capture_kind === 'knowledge_document_preview'
  ) {
    return 1;
  }
  return 0;
}

/**
 * 判定同一 canonical ref 的新快照是否应替换已选快照。
 * 质量只能单向升级；不同 Knowledge block 或 Web URL 是真正的引用歧义。
 */
export function selectEvidenceCandidate(params: {
  readonly existing: ResolvedEvidenceItem;
  readonly incoming: CompleteEvidenceCandidate;
}): EvidenceCandidateDecision {
  if (!isSameEvidencePointer(params.existing, params.incoming)) return 'conflict';

  if (params.existing.source_type === 'web' && params.incoming.source_type === 'web') {
    return params.existing.capture_kind === 'web_search_result' &&
      params.incoming.capture_kind === 'web_page'
      ? 'replace_existing'
      : 'keep_existing';
  }

  if (
    params.existing.source_type === 'knowledge_base' &&
    params.incoming.source_type === 'knowledge_base' &&
    getKnowledgeEvidenceQuality(params.incoming) > getKnowledgeEvidenceQuality(params.existing)
  ) {
    return 'replace_existing';
  }
  return 'keep_existing';
}
