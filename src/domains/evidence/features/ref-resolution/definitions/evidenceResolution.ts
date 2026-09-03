import type {
  EvidenceSourceType,
  KnowledgeEvidenceCaptureKind,
  WebEvidenceCaptureKind,
} from '../../../definitions/evidence';

/** EvidenceStore 中一条已接纳、可参与 ref 解析的候选快照。 */
export type CompleteEvidenceCandidate =
  | {
      readonly ref: string;
      readonly source_type: 'knowledge_base';
      readonly title: string;
      readonly snippet: string;
      readonly content_text: string;
      readonly capture_kind: KnowledgeEvidenceCaptureKind;
      readonly doc_id: string;
      readonly block_id: string;
      readonly doc_name?: string;
    }
  | {
      readonly ref: string;
      readonly source_type: 'web';
      readonly title: string;
      readonly snippet: string;
      readonly content_text: string;
      readonly url: string;
      readonly site_name?: string;
      readonly published_at?: string;
      readonly capture_kind: WebEvidenceCaptureKind;
    };

export type IncompleteEvidenceReason =
  | 'missing_doc_id'
  | 'missing_block_id'
  | 'missing_url'
  | 'missing_content_text';

/** Bundle wire 接纳结果；损坏项保留 ref 和根因，但不伪造完整来源。 */
export type EvidenceBundleScanEntry =
  | { readonly status: 'complete'; readonly item: CompleteEvidenceCandidate }
  | {
      readonly status: 'incomplete';
      readonly ref: string;
      readonly reason: IncompleteEvidenceReason;
    };

/** 单条已解析的证据项。ref 始终是 canonical 裸 token。 */
export interface ResolvedEvidenceItem {
  readonly ref: string;
  readonly bundle_id: string;
  readonly instance_id: string;
  readonly source_type: EvidenceSourceType;
  readonly title: string;
  readonly snippet: string;
  readonly doc_id?: string;
  readonly block_id?: string;
  readonly doc_name?: string;
  readonly url?: string;
  readonly site_name?: string;
  readonly published_at?: string;
  readonly capture_kind?: KnowledgeEvidenceCaptureKind | WebEvidenceCaptureKind;
  readonly text: string;
  readonly text_truncated: boolean;
  /** 仅在调用方显式请求且预览被截断时返回。 */
  readonly text_full?: string;
}

export interface RefConflict {
  readonly ref: string;
  readonly kept_bundle_id: string;
  readonly kept_instance_id: string;
  readonly ignored_bundle_ids: readonly string[];
  readonly ignored_instance_ids: readonly string[];
}

export interface IncompleteRefIssue {
  readonly ref: string;
  readonly bundle_id: string;
  readonly instance_id: string;
  readonly reason: IncompleteEvidenceReason;
}

/** Evidence ref 解析的稳定领域结果；不暴露 repository 或 bundle wire。 */
export interface ResolveEvidenceResult {
  readonly resolved: Readonly<Record<string, ResolvedEvidenceItem>>;
  readonly missing_refs: readonly string[];
  readonly incomplete_refs: readonly IncompleteRefIssue[];
  readonly scanned_bundle_count: number;
  readonly scanned_bundle_files: readonly string[];
  readonly hit_sources: Readonly<Record<string, string>>;
  readonly conflicts: readonly RefConflict[];
}
