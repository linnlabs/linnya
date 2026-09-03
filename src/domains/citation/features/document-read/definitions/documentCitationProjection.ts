export type DocumentCitationNodeSourceType = 'knowledge_base' | 'web' | 'manual';

export interface DocumentCitationNodeSnapshot {
  readonly attrs: Readonly<Record<string, unknown>>;
}

interface DocumentCitationSourceBase {
  readonly firstOccurrence: number;
  readonly citationIds: readonly string[];
  /** Citation-aware Markdown 正文中唯一允许用于窗口匹配的 canonical token。 */
  readonly bodyToken: string;
  readonly title: string;
  readonly excerpts: readonly string[];
}

export interface DocumentKnowledgeCitationSource extends DocumentCitationSourceBase {
  readonly sourceType: 'knowledge_base';
  readonly ref: string;
  readonly docId: string;
  readonly blockId: string;
  readonly kbId?: string;
}

export interface DocumentWebCitationSource extends DocumentCitationSourceBase {
  readonly sourceType: 'web';
  readonly ref: string;
  readonly url: string;
  readonly authors: readonly string[];
  readonly publishedAt?: string;
  readonly containerTitle?: string;
}

export interface DocumentManualCitationSource extends DocumentCitationSourceBase {
  readonly sourceType: 'manual';
  readonly citationId: string;
  readonly sourceId: string;
}

export type DocumentCitationSource =
  | DocumentKnowledgeCitationSource
  | DocumentWebCitationSource
  | DocumentManualCitationSource;

export type DocumentCitationDiagnosticCode =
  | 'invalid_citation'
  | 'manual_source'
  | 'excerpt_unavailable'
  | 'excerpt_truncated'
  | 'excerpt_omitted';

export interface DocumentCitationDiagnostic {
  readonly code: DocumentCitationDiagnosticCode;
  readonly message: string;
  /** 与当前正文窗口匹配的 canonical token；不得用原始 citationId 代替。 */
  readonly bodyToken: string;
  readonly citationId?: string;
  readonly ref?: string;
}

export interface DocumentCitationProjection {
  readonly sources: readonly DocumentCitationSource[];
  readonly diagnostics: readonly DocumentCitationDiagnostic[];
  /** Pending Markdown 只能按已接纳的 citationId 取得正文 token，不能按可见文本猜测。 */
  getBodyTokenForCitationId(citationId: string): string;
}

export interface DocumentCitationAppendixBudget {
  readonly totalExcerptChars: number;
  readonly perSourceExcerptChars: number;
}

/**
 * 复用当前持久化 citation snapshot（单段上限 500）与 Deep Research source context
 * （单来源读取上限 2000）之间的保守首版预算：每来源最多 500，当前窗口合计最多 4000。
 */
export const DEFAULT_DOCUMENT_CITATION_APPENDIX_BUDGET: DocumentCitationAppendixBudget = {
  totalExcerptChars: 4000,
  perSourceExcerptChars: 500,
};

export interface DocumentCitationAppendixResult {
  readonly text: string;
  readonly diagnostics: readonly DocumentCitationDiagnostic[];
  /** 结构化 metadata 必须复用这里的预算后摘录，禁止再次读取完整 snapshots 绕过预算。 */
  readonly sourceExcerpts: readonly DocumentCitationAppendixSourceExcerpt[];
}

export interface DocumentCitationAppendixSourceExcerpt {
  readonly bodyToken: string;
  readonly excerpt: string;
  readonly status: 'complete' | 'truncated' | 'unavailable' | 'omitted';
}
