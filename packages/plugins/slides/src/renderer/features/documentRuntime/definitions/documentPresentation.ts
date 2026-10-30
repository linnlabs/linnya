import type { SlideRenderModel } from '@plugin/slides/shared/renderModel';
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

/** 视图只上报完整视觉帧；runtime 验证它仍属于当前文稿和选页。 */
export interface PresentationFrame {
  readonly documentId: string;
  readonly revision: number;
  readonly slide: SlideRenderModel | null;
}
export interface PresentedFrameReceipt {
  readonly epoch: number;
  readonly revision: number;
  readonly slideId: string | null;
}
