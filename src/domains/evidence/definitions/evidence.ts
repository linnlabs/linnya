/**
 * @file src/domains/evidence/definitions/evidence.ts
 * @description Evidence domain 的稳定公共定义。
 */

export type EvidenceSourceType = 'knowledge_base' | 'web';

export type KnowledgeEvidenceCaptureKind =
  | 'knowledge_search_result'
  | 'knowledge_document_preview'
  | 'knowledge_document_chunk';

export type WebEvidenceCaptureKind = 'web_search_result' | 'web_page';

export type HistoricalEvidenceBundleKind = 'assemble_evidence';
export type LiveEvidenceBundleKind = 'knowledge_evidence' | 'web_evidence';
export type EvidenceBundleKind = HistoricalEvidenceBundleKind | LiveEvidenceBundleKind;

export type EvidenceItemBase = {
  ref_id: string;
  source_type: EvidenceSourceType;
  title: string;
  snippet: string;
  content_text: string;
  captured_at_ms: number;
};

export type KnowledgeBaseEvidenceItem = EvidenceItemBase & {
  source_type: 'knowledge_base';
  capture_kind: KnowledgeEvidenceCaptureKind;
  doc_id: string;
  block_id: string;
  doc_name?: string;
};

export type WebEvidenceItem = EvidenceItemBase & {
  source_type: 'web';
  url: string;
  normalized_url: string;
  site_name?: string;
  published_at?: string;
  capture_kind: WebEvidenceCaptureKind;
};

export type UnifiedEvidenceItem = KnowledgeBaseEvidenceItem | WebEvidenceItem;
