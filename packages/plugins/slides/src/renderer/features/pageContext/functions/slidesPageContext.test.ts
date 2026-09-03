import { describe, expect, it } from 'vitest';
import type { DeckPreviewViewModel } from '../../../types/preview';
import {
  buildSlidesDocumentContextFragment,
  buildSlidesPageContextDocument,
  buildSlidesPageContextSelection,
  buildSlidesPageContextSummary,
} from './slidesPageContext';

function makeDeckPreview(): DeckPreviewViewModel {
  return {
    nodeId: 'deck-1',
    versionNumber: 3,
    title: 'Quarterly Review',
    slideSize: { width: 10, height: 5.625 },
    theme: {
      colors: {},
      fonts: { major: 'Inter', minor: 'Inter' },
    },
    warnings: [],
    slides: [
      {
        slideId: 'slide-1',
        number: 1,
        layoutName: 'Title',
        elements: [
          { elementId: 'title', type: 'text', text: 'Q1 results' },
          { elementId: 'empty', type: 'text', text: '   ' },
          { elementId: 'shape', type: 'shape' },
        ],
      },
      {
        slideId: 'slide-2',
        number: 2,
        layoutName: 'Metrics',
        elements: [
          { elementId: 'metric-1', type: 'text', text: 'Revenue' },
          { elementId: 'metric-2', type: 'text', text: 'Margin' },
        ],
      },
    ],
  };
}

describe('slides page context functions', () => {
  it('builds document and summary from the active deck snapshot', () => {
    const input = {
      currentDeckId: 'deck-1',
      deckPreview: makeDeckPreview(),
      currentSlideIndex: 1,
    };

    expect(buildSlidesPageContextDocument(input)).toEqual({
      id: 'deck-1',
      type: 'presentation',
      title: 'Quarterly Review',
    });
    expect(buildSlidesPageContextSummary(input)).toEqual({
      sections: [{
        sectionName: 'slides_summary',
        lines: [
          'slide_count=2',
          'current_slide_number=2',
          'warning_count=0',
        ],
      }],
    });
  });

  it('returns no document, summary, or fragment when no deck is open', () => {
    const input = {
      currentDeckId: null,
      deckPreview: makeDeckPreview(),
      currentSlideIndex: 0,
    };

    expect(buildSlidesPageContextDocument(input)).toBeUndefined();
    expect(buildSlidesPageContextSummary(input)).toBeUndefined();
    expect(buildSlidesDocumentContextFragment(input)).toBeNull();
  });

  it('prefers source-backed selections and falls back to the UI selected element', () => {
    expect(buildSlidesPageContextSelection({
      sourceSelectedElementIds: ['source-a', 'source-b'],
      selectedElementId: 'legacy-selected',
    })).toEqual({
      selectedElementIds: ['source-a', 'source-b'],
    });

    expect(buildSlidesPageContextSelection({
      sourceSelectedElementIds: [],
      selectedElementId: 'legacy-selected',
    })).toEqual({
      selectedElementIds: ['legacy-selected'],
    });

    expect(buildSlidesPageContextSelection({
      sourceSelectedElementIds: [],
      selectedElementId: null,
    })).toBeUndefined();
  });

  it('builds a stable document fragment for conversation context', () => {
    const fragment = buildSlidesDocumentContextFragment({
      currentDeckId: 'deck-1',
      deckPreview: makeDeckPreview(),
      currentSlideIndex: 0,
    });

    expect(fragment).toBe([
      '[slides_document]',
      'presentation_id=deck-1',
      'title="Quarterly Review"',
      'slide_count=2',
      'current_slide_index=1',
      '[current_slide]',
      'slide_id=slide-1',
      'slide_number=1',
      'layout="Title"',
      'text_elements=[{"id":"title","type":"text","text":"Q1 results"}]',
    ].join('\n'));
  });

  it('limits document fragment text element evidence to the first eight non-empty entries', () => {
    const deckPreview = makeDeckPreview();
    deckPreview.slides[0] = {
      slideId: 'slide-many',
      number: 1,
      elements: Array.from({ length: 10 }, (_, index) => ({
        elementId: `text-${index + 1}`,
        type: 'text',
        text: `Line ${index + 1}`,
      })),
    };

    const fragment = buildSlidesDocumentContextFragment({
      currentDeckId: 'deck-1',
      deckPreview,
      currentSlideIndex: 0,
    });

    expect(fragment).toContain('"id":"text-8"');
    expect(fragment).not.toContain('"id":"text-9"');
  });
});
