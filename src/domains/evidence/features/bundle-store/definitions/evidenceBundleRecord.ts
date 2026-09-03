import type {
  KnowledgeEvidenceCaptureKind,
  KnowledgeBaseEvidenceItem,
  WebEvidenceItem,
} from '../../../definitions/evidence';

interface EvidenceBundleRecordBaseV1 {
  readonly version: 1;
  readonly created_at_ms: number;
  readonly conversation_id?: string;
  readonly turn_id?: string;
  readonly tool_call_id?: string;
  readonly query: string;
  readonly summary?: string;
}

/** 历史 assemble_evidence 文件可能早于 capture_kind。 */
export type HistoricalAssembleEvidenceBundleStoredItemV1 = Omit<
  KnowledgeBaseEvidenceItem,
  'capture_kind'
> & {
  readonly capture_kind?: KnowledgeEvidenceCaptureKind;
};

export interface HistoricalAssembleEvidenceBundleRecordV1 extends EvidenceBundleRecordBaseV1 {
  readonly kind: 'assemble_evidence';
  readonly items: readonly HistoricalAssembleEvidenceBundleStoredItemV1[];
}

export interface KnowledgeEvidenceBundleRecordV1 extends EvidenceBundleRecordBaseV1 {
  readonly kind: 'knowledge_evidence';
  readonly items: readonly KnowledgeBaseEvidenceItem[];
}

export interface WebEvidenceBundleRecordV1 extends EvidenceBundleRecordBaseV1 {
  readonly kind: 'web_evidence';
  readonly items: readonly WebEvidenceItem[];
}

export type LiveEvidenceBundleRecordV1 =
  | KnowledgeEvidenceBundleRecordV1
  | WebEvidenceBundleRecordV1;
