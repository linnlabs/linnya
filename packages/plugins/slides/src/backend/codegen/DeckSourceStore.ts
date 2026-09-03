import type {
  PresentationRepositoryPort,
  PresentationDocumentRecord,
} from '../persistence';

export const DECK_NOT_CODEGEN_READY = 'deck_not_codegen_ready';

export type DeckSourceStoreErrorCode = typeof DECK_NOT_CODEGEN_READY;

export interface DeckSourceReadResult {
  document: PresentationDocumentRecord;
  source: string;
}

export class DeckSourceStoreError extends Error {
  readonly code: DeckSourceStoreErrorCode;

  constructor(message: string) {
    super(message);
    this.name = 'DeckSourceStoreError';
    this.code = DECK_NOT_CODEGEN_READY;
  }
}

export class DeckSourceStore {
  constructor(
    private readonly presentationRepo: Pick<PresentationRepositoryPort, 'getPresentation'>,
  ) {}

  async requireCodegenReady(nodeId: string): Promise<DeckSourceReadResult> {
    const document = await this.readPresentationOrThrow(nodeId);
    const source = this.readNonEmptySource(document);
    if (!source) {
      throw new DeckSourceStoreError(
        `${DECK_NOT_CODEGEN_READY}: generated presentation ${nodeId} has no deck.js source`,
      );
    }

    return { document, source };
  }

  async readOptionalSource(nodeId: string): Promise<DeckSourceReadResult | null> {
    const document = await this.presentationRepo.getPresentation(nodeId);
    if (!document) {
      return null;
    }

    const source = this.readNonEmptySource(document);
    return source ? { document, source } : null;
  }

  private async readPresentationOrThrow(nodeId: string): Promise<PresentationDocumentRecord> {
    const document = await this.presentationRepo.getPresentation(nodeId);
    if (!document) {
      throw new Error(`Presentation not found: ${nodeId}`);
    }
    return document;
  }

  private readNonEmptySource(document: PresentationDocumentRecord): string | null {
    if (document.deckSource.trim().length === 0) {
      return null;
    }
    return document.deckSource;
  }
}
