import type {
  DocumentBacklinksPage,
  DocumentBacklinksRequest,
  DocumentBacklinkSource,
} from '@app/schemas';
export interface BacklinksPanelState extends DocumentBacklinksPage {
  readonly phase: 'loading' | 'ready' | 'failed' | 'closed';
  readonly error: boolean;
}
export interface BacklinksPanelPort {
  list(request: DocumentBacklinksRequest): Promise<DocumentBacklinksPage>;
  open(source: DocumentBacklinkSource): Promise<void>;
  subscribe(listener: () => void): () => void;
}
