export interface KnowledgeSearchMatchPresentation {
  readonly id: string;
  readonly snippet: string;
}

export interface KnowledgeSearchFilePresentation {
  readonly docId: string;
  readonly docName: string;
  readonly matches: readonly KnowledgeSearchMatchPresentation[];
}

export interface KnowledgeSearchLifecyclePresentation {
  readonly kind: 'lifecycle';
  readonly query?: string;
  readonly requestedDeepSearch?: boolean;
  readonly searchMode?: 'global' | 'document';
}

export interface KnowledgeSearchResultsPresentation {
  readonly kind: 'results';
  readonly query: string;
  readonly requestedDeepSearch: boolean;
  readonly actualStrategy: 'shallow' | 'deep';
  readonly subrunId?: string;
  readonly searchMode: 'global' | 'document';
  readonly docName: string | null;
  readonly files: readonly KnowledgeSearchFilePresentation[];
}

export interface HistoricalKnowledgeSearchSnapshotPointerPresentation {
  readonly kind: 'historical-snapshot-pointer';
  readonly query: string;
  readonly requestedDeepSearch: boolean;
  readonly bundleId: string;
  readonly count: number;
}

export type KnowledgeSearchPresentationData =
  | KnowledgeSearchLifecyclePresentation
  | KnowledgeSearchResultsPresentation
  | HistoricalKnowledgeSearchSnapshotPointerPresentation;
