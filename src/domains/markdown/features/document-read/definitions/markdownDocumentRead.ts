import type {
  WorkspaceDocumentReadData,
} from '@app/schemas';
import type { DocumentCitationProjection } from '../../../../citation';
import type { MarkdownDocJson } from '../../normalization';
import type { MarkdownPendingRevisionLike } from '../../pending-revisions';

export interface MarkdownDocumentReadRequest {
  readonly documentId: string;
  readonly documentName: string;
  readonly viewMode: 'preview' | 'base';
  readonly maxChars: number;
  readonly offsetChars: number;
  readonly structureOnly: boolean;
}

export interface MarkdownDocumentReadStore {
  readonly getDocument: (documentId: string) => MarkdownDocJson;
  readonly getPendingRevisions: (
    documentId: string,
  ) => readonly MarkdownPendingRevisionLike[];
}

export interface MarkdownDocumentNormalizer {
  readonly normalizeDocumentIfNeeded: (documentId: string) => Promise<{
    readonly status: 'normalized' | 'already_normalized' | 'failed';
    readonly reason?: string;
  }>;
}

export interface MarkdownDocumentReadProjection {
  readonly data: WorkspaceDocumentReadData;
  /** DocumentView 或 outline 正文；Workspace 在其后插入 wire Citation appendix。 */
  readonly primaryObservation: string;
  readonly trailingObservations: readonly string[];
  readonly citationWindow?: {
    readonly bodyWindow: string;
    readonly projection: DocumentCitationProjection;
  };
}
