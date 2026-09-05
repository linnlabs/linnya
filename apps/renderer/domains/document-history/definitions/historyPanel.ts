import type {
  DocumentHistoryFailureCode,
  DocumentHistoryListResponse,
  DocumentHistoryRestoreResponse,
  DocumentVersionRestoreRequest,
  DocumentVersionSummary,
} from '@app/schemas';

export interface HistoryPanelState {
  readonly phase: 'loading' | 'ready' | 'restoring' | 'closed';
  readonly recent: readonly DocumentVersionSummary[];
  readonly earlier: readonly DocumentVersionSummary[];
  readonly selectedId: string | null;
  readonly error: DocumentHistoryFailureCode | null;
}
export interface HistoryPanelPort {
  list(documentId: string): Promise<DocumentHistoryListResponse>;
  restore(request: DocumentVersionRestoreRequest): Promise<DocumentHistoryRestoreResponse>;
}
