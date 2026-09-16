import type { DeckSpec } from '@plugin/slides/shared';

export interface PresentationPptxArtifactSnapshot {
  readonly nodeId: string;
  readonly revisionId: string;
  readonly revision: number;
  readonly deckSource: string;
  readonly deckSpec: DeckSpec;
  readonly title: string;
  readonly pptxBuffer: Buffer;
}

export interface PresentationPptxArtifactPort {
  loadCurrent(nodeId: string): Promise<PresentationPptxArtifactSnapshot>;
}
