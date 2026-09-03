import type {
  SlidesDeckPageContextInput,
  SlidesPageContextDocument,
  SlidesPageContextSelection,
  SlidesPageContextSummary,
  SlidesSelectionPageContextInput,
} from '../definitions/pageContextTypes';
import { SLIDES_DOCUMENT_TYPE } from '@plugin/slides/shared/pluginMeta';

export function buildSlidesPageContextDocument(
  input: SlidesDeckPageContextInput,
): SlidesPageContextDocument | undefined {
  if (!input.currentDeckId) {
    return undefined;
  }

  return {
    id: input.currentDeckId,
    type: SLIDES_DOCUMENT_TYPE,
    title: input.deckPreview?.title,
  };
}

export function buildSlidesPageContextSelection(
  input: SlidesSelectionPageContextInput,
): SlidesPageContextSelection | undefined {
  if (input.sourceSelectedElementIds.length > 0) {
    return { selectedElementIds: [...input.sourceSelectedElementIds] };
  }

  return input.selectedElementId
    ? { selectedElementIds: [input.selectedElementId] }
    : undefined;
}

export function buildSlidesPageContextSummary(
  input: SlidesDeckPageContextInput,
): SlidesPageContextSummary | undefined {
  if (!input.currentDeckId || !input.deckPreview) {
    return undefined;
  }

  const currentSlide = input.deckPreview.slides[input.currentSlideIndex] ?? undefined;
  const lines = [`slide_count=${input.deckPreview.slides.length}`];
  if (typeof currentSlide?.number === 'number') {
    lines.push(`current_slide_number=${currentSlide.number}`);
  }
  lines.push(`warning_count=${input.deckPreview.warnings.length}`);

  return {
    sections: [{
      sectionName: 'slides_summary',
      lines,
    }],
  };
}

export function buildSlidesDocumentContextFragment(
  input: SlidesDeckPageContextInput,
): string | null {
  if (!input.currentDeckId || !input.deckPreview) {
    return null;
  }

  const lines: string[] = [
    '[slides_document]',
    `presentation_id=${input.currentDeckId}`,
    `title=${JSON.stringify(input.deckPreview.title)}`,
    `slide_count=${input.deckPreview.slides.length}`,
    `current_slide_index=${input.currentSlideIndex + 1}`,
  ];

  const currentSlide = input.deckPreview.slides[input.currentSlideIndex] ?? undefined;
  if (currentSlide) {
    lines.push('[current_slide]');
    lines.push(`slide_id=${currentSlide.slideId}`);
    lines.push(`slide_number=${currentSlide.number}`);
    if (currentSlide.layoutName) {
      lines.push(`layout=${JSON.stringify(currentSlide.layoutName)}`);
    }

    const textElements = currentSlide.elements
      .filter((element) => typeof element.text === 'string' && element.text.trim().length > 0)
      .slice(0, 8)
      .map((element) => ({
        id: element.elementId,
        type: element.type,
        text: element.text,
      }));
    if (textElements.length > 0) {
      lines.push(`text_elements=${JSON.stringify(textElements)}`);
    }
  }

  return lines.join('\n');
}
