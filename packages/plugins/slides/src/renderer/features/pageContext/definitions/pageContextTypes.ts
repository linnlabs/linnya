import type { RendererPageContextSummary } from '@plugin/renderer/pageContextProvider';
import type { SLIDES_DOCUMENT_TYPE } from '@plugin/slides/shared/pluginMeta';
import type { DeckPreviewViewModel } from '../../../types/preview';

export interface SlidesPageContextDocument {
  id: string;
  type: typeof SLIDES_DOCUMENT_TYPE;
  title?: string;
}

export interface SlidesPageContextSelection {
  selectedElementIds: string[];
}

export interface SlidesPageSummary {
  readonly slideCount: number;
  readonly currentSlideNumber?: number;
  readonly warningCount?: number;
}

export interface SlidesPageContextSummary extends RendererPageContextSummary {
  sections: readonly [{
    readonly sectionName: 'slides_summary';
    readonly lines: readonly string[];
  }];
}

export interface SlidesDeckPageContextInput {
  currentDeckId: string | null;
  deckPreview: DeckPreviewViewModel | null;
  currentSlideIndex: number;
}

export interface SlidesSelectionPageContextInput {
  sourceSelectedElementIds: readonly string[];
  selectedElementId: string | null;
}
