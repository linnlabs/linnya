import type { InstalledPresentationView } from '@plugin/slides/shared/presentationViewSnapshot';
export interface DocumentPresentationState {
  readonly documentId: string | null;
  readonly epoch: number;
  readonly installed: InstalledPresentationView | null;
  readonly selectedIndex: number;
  readonly selectionEpoch: number;
  readonly loading: boolean;
  readonly error: string | null;
}

export interface PendingStructureSelection {
  readonly epoch: number;
  readonly selectionEpoch: number;
  readonly target: number;
  readonly base: number;
  readonly confirmed: Promise<number | null>;
}
export interface PresentationSelectionInput {
  readonly currentIndex: number;
  readonly slideCount: number;
  readonly revision: number;
  readonly selectionEpoch: number;
  readonly confirmedRevision: number | null;
  readonly intent: Pick<PendingStructureSelection, 'target' | 'selectionEpoch'> | null;
}
